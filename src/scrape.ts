import { getResult, addResult } from "./db.js"
import { StashApp } from "./stash-app.js"
import { genJobID } from "./utils.js"
import { uploadImage } from "./b2.js"
import { consumeKeyCredit, keyStatus } from "./apikey.js"
import { jobResult } from "../types/jobResult.js"

// apiKey is only passed by the HTTP routes — Discord commands are role-gated,
// not rate-limited. Cache hits are free; an actual scrape consumes a credit.
const checkCredit = async (apiKey?: string): Promise<{ status: number, body: string } | null> => {
  if (apiKey === undefined) return null
  const credit = await consumeKeyCredit(apiKey)
  if (credit === keyStatus.exhausted) return { status: 429, body: 'API key rate limit exceeded' }
  if (credit === keyStatus.invalid) return { status: 401, body: 'Unauthorized' }
  return null
}

// shared by the HTTP API and the Discord /interactions route
export const getScrapeResult = async (type: string, url: string, rescrape = false, apiKey?: string): Promise<{ status: number, body: Object | string }> => {
  // only support scenes for now
  if (type !== 'scene') {
    return { status: 400, body: { error: 'Invalid scrapeType. Valid types are: scene' } }
  }
  // try finding existing result first
  const existingResult = await getResult(url)
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
  // check update packages
  await stash.checkUpdatePackages()
  // set start time
  const startTime = new Date()
  const result = await stash.startScrape(url)
  // if error, return
  if (result.error) {
    return { status: 500, body: result }
  }
  // get logs
  const logs = await stash.getLogs(startTime)
  // get package versions
  const scraperVersion = await stash.getPkgVersion(searchResult?.id)
  // replace image with CDN url
  const imageURL = await uploadImage(result.result?.image ?? "", jobId)
  if (imageURL) result.result!.image = imageURL
  const cachedResult: jobResult = {
    jobId,
    ...result,
    result: result.result!,
    runnerInfo: {
      scraperId: searchResult?.id,
      scraperName: searchResult?.name,
      scraperVersion,
      ...result.runnerInfo
    },
    stashInfo: result.stashInfo,
    logs,
  }
  // insert
  addResult(cachedResult, url)
  return { status: 200, body: cachedResult }
}
