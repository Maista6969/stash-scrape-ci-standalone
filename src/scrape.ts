import { getResult, addResult } from "./db.js"
import { StashApp } from "./stash-app.js"
import { genJobID } from "./utils.js"
import { uploadImage } from "./b2.js"
import { jobResult } from "../types/jobResult.js"

// shared by the HTTP API and the Discord /interactions route
export const getScrapeResult = async (type: string, url: string, rescrape = false): Promise<{ status: number, body: Object | string }> => {
  // only support scenes for now
  if (type !== 'scene') {
    return { status: 400, body: { error: 'Invalid scrapeType. Valid types are: scene' } }
  }
  // try finding existing result first
  const existingResult = await getResult(url)
  if (!rescrape && existingResult) {
    return { status: 200, body: existingResult }
  }
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
