import { getCachedResult, addResult, addPendingResult, completePendingResult, listMonitorUrls, addMonitorUrls, updateMonitorUrl } from "./db.js"
import { bareHost, nextBaseline, presentFields } from "./monitor.js"
import { StashApp } from "./stash-app.js"
import { genJobID, serialized } from "./utils.js"
import { uploadImage } from "./b2.js"
import { consumeKeyCredit, keyStatus } from "./apikey.js"
import { searchScrapers } from "./scraper-index.js"
import { jobResult, runnerInfo } from "../types/jobResult.js"

// apiKey is only passed by the HTTP routes — Discord commands are role-gated,
// not rate-limited. Cache hits are free; an actual scrape consumes a credit.
const checkCredit = async (apiKey?: string): Promise<{ status: number, body: string } | null> => {
  if (apiKey === undefined) return null
  const credit = await consumeKeyCredit(apiKey)
  if (credit === keyStatus.exhausted) return { status: 429, body: 'API key rate limit exceeded' }
  if (credit === keyStatus.invalid) return { status: 401, body: 'Unauthorized' }
  return null
}

// the actual scrape chain; returns a storable job document whether the scrape
// succeeds or errors
const runScrapeJob = async (stash: StashApp, searchResult: { id: string, name: string }, url: string, jobId: string): Promise<jobResult> => {
  // check update packages
  await stash.checkUpdatePackages()
  const { result, logs } = await serialized(async () => {
    const start = new Date()
    const result = await stash.startScrape(url)
    return { result, logs: await stash.getLogs(start, new Date()) }
  })
  // get package versions
  const scraperVersion = await stash.getPkgVersion(searchResult.id)
  // replace image with CDN url
  if (result.result) {
    // a failed upload keeps the image inline rather than losing the whole scrape
    const imageURL = await uploadImage(result.result.image ?? "", jobId)
      .catch(err => console.error(`Image upload for ${jobId} failed:`, err.message))
    if (imageURL) result.result.image = imageURL
  }
  return {
    jobId,
    ...result,
    runnerInfo: {
      scraperId: searchResult.id,
      scraperName: searchResult.name,
      scraperVersion,
      ...result.runnerInfo
    },
    logs,
  }
}

// a user's successful scrape of a domain the monitor doesn't cover yet seeds it, using the
// scrape itself as the baseline; failed or empty scrapes are skipped since a bad URL looks the same as a broken scraper
const autoMonitor = async (job: jobResult, url: string) => {
  if (job.error || !presentFields(job.result as Record<string, unknown> | undefined).length) return
  const host = bareHost(new URL(url).hostname)
  if ((await listMonitorUrls()).some(u => bareHost(new URL(u.url).hostname) === host)) return
  const [scraper] = await searchScrapers(url)
  if (!scraper) return
  const scraped = job.result as any
  if (await addMonitorUrls([{
    url,
    scraperId: scraper.id,
    studio: scraped.studio?.name ?? null,
    network: scraped.studio?.parent?.name ?? null,
    source: "auto",
  }])) await updateMonitorUrl(url, { baseline: nextBaseline(null, scraped) })
}
const autoMonitorInBackground = (job: jobResult, url: string) =>
  autoMonitor(job, url).catch(err => console.error(`Auto-monitoring ${url} failed:`, err))

// synchronous mode: shared by the HTTP API (default) and the Discord
// /interactions route; responds only once the scrape has finished
export const getScrapeResult = async (type: string, url: string, rescrape = false, apiKey?: string): Promise<{ status: number, body: Object | string }> => {
  // only support scenes for now
  if (type !== 'scene') {
    return { status: 400, body: { error: 'Invalid scrapeType. Valid types are: scene' } }
  }
  // try finding existing result first
  const existingResult = await getCachedResult(url)
  if (!rescrape && existingResult) {
    return { status: 200, body: existingResult }
  }
  const creditError = await checkCredit(apiKey)
  if (creditError) return creditError
  // set up stash instance
  const stash = new StashApp()
  const searchResult = await stash.urlSeachScrapers(url)
  if ("error" in searchResult) {
    return { status: 422, body: searchResult }
  }
  const jobId = genJobID()
  // like runSubmittedScrape: an unexpected failure is stored too, so it shows up instead of vanishing
  const cachedResult: jobResult = await runScrapeJob(stash, searchResult, url, jobId)
    .catch(err => {
      console.error(`Scrape ${jobId} failed:`, err)
      return { jobId, error: (err as Error).message, runnerInfo: { url, scrapeType: "scene", date: new Date().toISOString() }, logs: [] }
    })
  // failures are stored too — they get a debug page with logs, but
  // getCachedResult skips them so retries still re-scrape
  addResult(cachedResult, url)
  autoMonitorInBackground(cachedResult, url)
  return { status: cachedResult.error ? 500 : 200, body: cachedResult }
}

// async mode (opt-in via `async: true`): answers immediately with a jobId and
// runs the scrape in the background; poll /api/result/:jobId for completion
export const submitScrape = async (type: string, url: string, rescrape = false, apiKey?: string): Promise<{ status: number, body: Object | string }> => {
  if (type !== 'scene') {
    return { status: 400, body: { error: 'Invalid scrapeType. Valid types are: scene' } }
  }
  const existingResult = await getCachedResult(url)
  if (!rescrape && existingResult) {
    return { status: 200, body: existingResult }
  }
  // fail fast (and free) on URLs no scraper matches, before creating a job
  const matched = await searchScrapers(url)
  if (matched.length === 0) {
    return { status: 422, body: { error: "No scrapers found for the provided URL." } }
  }
  const creditError = await checkCredit(apiKey)
  if (creditError) return creditError
  const jobId = genJobID()
  const jobRunnerInfo: runnerInfo = { url, scrapeType: "scene", date: new Date().toISOString() }
  await addPendingResult(jobId, url, jobRunnerInfo)
  runSubmittedScrape(jobId, url, jobRunnerInfo)
  return { status: 202, body: { jobId, pending: true } }
}

// background continuation of submitScrape; must always complete the pending doc
const runSubmittedScrape = async (jobId: string, url: string, jobRunnerInfo: runnerInfo) => {
  try {
    const stash = new StashApp()
    const searchResult = await stash.urlSeachScrapers(url)
    const cachedResult: jobResult = ("error" in searchResult)
      ? { jobId, error: searchResult.error, runnerInfo: jobRunnerInfo, logs: [] }
      : await runScrapeJob(stash, searchResult, url, jobId)
    await completePendingResult(jobId, cachedResult, url)
    autoMonitorInBackground(cachedResult, url)
  } catch (err) {
    console.error(`Background scrape ${jobId} failed:`, err)
    await completePendingResult(jobId, { jobId, error: (err as Error).message, runnerInfo: jobRunnerInfo, logs: [] }, url)
      .catch(dbErr => console.error(`Failed to store background scrape failure ${jobId}:`, dbErr))
  }
}
