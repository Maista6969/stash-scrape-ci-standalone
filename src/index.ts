// imports
import { connect, createIndex, getResult, createApiKey, revokeApiKey, reactivateApiKey, listApiKeys, listRecentScrapes, listMonitorUrls, addMonitorUrls, getMonitorUrl, removeMonitorUrl, updateMonitorUrl, acceptMonitorFields, snoozeMonitorUrls, syncOverviewRows, getLatestResults, monitorUrl } from "./db.js"
import { classify, nextBaseline, parseOverview, fetchOverview, isValidPackageId, pickDue, coverage, fetchOverviewIds, siblingFields, applySnooze } from "./monitor.js"
import { searchScrapers, getScraperId, fetchScraperIndex, matchScrapers } from "./scraper-index.js"
import { StashApp, updateScrapersWithDiff } from "./stash-app.js"
import { helpText } from "./utils.js"
import { checkKeyValidity, getKeyUsage } from "./apikey.js"
import 'dotenv/config'

import Koa from "koa"
const app = new Koa()
import cors from '@koa/cors';
import bodyParser from "@koa/bodyparser";
import serve from 'koa-static';

import Router from '@koa/router';
import { getScrapeResult, submitScrape } from "./scrape.js"
import { verifyDiscordSignature, handleInteraction } from "./discord.js"
const router = new Router();

// missing definition patches
const getRequestKey = (ctx: Koa.Context): string =>
  (ctx.request as any).body?.auth || ctx.query.auth || ctx.headers['x-api-key']

// authenticates only — rate-limit credits are consumed in getScrapeResult,
// so cached lookups stay free
const koaValidate = async (ctx: Koa.Context, next: Koa.Next) => {
  if (!await checkKeyValidity(getRequestKey(ctx))) {
    ctx.status = 401
    ctx.body = 'Unauthorized'
    return
  }
  return next()
}

const koaValidateAdmin = async (ctx: Koa.Context, next: Koa.Next) => {
  const apikey = getRequestKey(ctx)
  if (!process.env.ADMIN_KEY || apikey !== process.env.ADMIN_KEY) {
    ctx.status = 401
    ctx.body = 'Unauthorized'
    return
  }
  return next()
}

router.get('/', async (ctx) => {
  ctx.body = helpText
})

router.get("/api", async (ctx) => {
  ctx.body = helpText
})

// admin api
router.post("/api/admin/apikey", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body || !body.note) {
    ctx.status = 400
    ctx.body = 'Note is required to create API key'
    return
  }
  const limit = body.limit || 200
  const apiKey = await createApiKey(body.note, limit)
  ctx.body = { apiKey, limit }
})

router.get("/api/admin/apikey", koaValidateAdmin, async (ctx) => {
  const keys = await listApiKeys()
  ctx.body = await Promise.all(keys.map(async (key) => ({
    apikey: key.apikey,
    note: key.note,
    limit: key.limit,
    createdAt: key.createdAt,
    active: key.active,
    revokedAt: key.revokedAt,
    ...(await getKeyUsage(key.apikey))
  })))
})

router.delete("/api/admin/apikey", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body || !body.key) {
    ctx.status = 400
    ctx.body = 'API key is required to revoke'
    return
  }
  await revokeApiKey(body.key)
  ctx.body = 'API key revoked successfully'
})

router.get("/api/admin/scrapes", koaValidateAdmin, async (ctx) => {
  const limit = Math.min(Number(ctx.query.limit) || 20, 100)
  const scrapes = await listRecentScrapes(limit)
  ctx.body = scrapes.map((doc: any) => ({
    jobId: doc.jobId,
    url: doc.url,
    title: doc.result?.title ?? null,
    scrapeType: doc.runnerInfo?.scrapeType,
    date: doc.runnerInfo?.date
  }))
})

router.get("/api/admin/scrapers", koaValidateAdmin, async (ctx) => {
  const stash = new StashApp()
  ctx.body = await stash.getInstalledScrapers()
})

router.post("/api/admin/scraper", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body || !body.id) {
    ctx.status = 400
    ctx.body = 'Scraper package id is required'
    return
  }
  const stash = new StashApp()
  const jobId = await stash.installPackage(body.id)
  await stash.awaitJobFinished(jobId).catch(() => {})
  await stash.reloadScrapers()
  // the job can also "finish" without installing anything (e.g. unknown id),
  // so verify the package actually landed rather than trusting job status
  const version = await stash.getPkgVersion(body.id)
  if (!version) {
    ctx.status = 422
    ctx.body = `Package ${body.id} was not installed — check the id against the package index`
    return
  }
  ctx.body = { installed: body.id, version }
})

router.delete("/api/admin/scraper", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body || !body.id) {
    ctx.status = 400
    ctx.body = 'Scraper package id is required'
    return
  }
  const stash = new StashApp()
  const version = await stash.getPkgVersion(body.id)
  if (!version) {
    ctx.status = 404
    ctx.body = `Package ${body.id} is not installed`
    return
  }
  const jobId = await stash.uninstallPackage(body.id)
  await stash.awaitJobFinished(jobId)
  await stash.reloadScrapers()
  ctx.body = { removed: body.id, version }
})

// monitor: URLs watched per scraper, each with its latest scrape and regression status
router.get("/api/admin/monitor", koaValidateAdmin, async (ctx) => {
  const urls = await listMonitorUrls()
  const latest = new Map((await getLatestResults(urls.map(u => u.url))).map(doc => [doc._id, doc]))
  ctx.body = urls.map(u => {
    const doc = latest.get(u.url)
    const siblings = urls.filter(s => s.scraperId === u.scraperId && s.url !== u.url).map(s => s.baseline)
    const verdict = applySnooze(classify(doc, u.baseline, siblingFields(siblings), u.accepted), u.snoozedUntil)
    return {
      ...u,
      ...verdict,
      latest: doc ? {
        jobId: doc.jobId,
        date: doc.date,
        error: doc.error ?? (verdict.status === "error" ? "Scrape returned no fields" : null),
        scraperId: doc.scraperId ?? null,
        title: doc.result?.title ?? null,
        studio: doc.result?.studio?.name ?? null,
      } : null,
    }
  })
})

// which scene-by-URL scrapers in the repo have no monitored URLs yet, and which of those can be imported
router.get("/api/admin/monitor/coverage", koaValidateAdmin, async (ctx) => {
  const [index, urls, overviews] = await Promise.all([fetchScraperIndex(), listMonitorUrls(), fetchOverviewIds()])
  const scrapers = index
    .filter(s => s.searchTypes?.scene?.url)
    .map(s => ({ scraperId: getScraperId(s), name: s.name, hosts: s.hosts ?? [] }))
  ctx.body = coverage(scrapers, urls).map(pkg => ({ ...pkg, overview: overviews.has(pkg.scraperId) }))
})

router.post("/api/admin/monitor/url", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body?.url || !URL.canParse(body.url) || !/^https?:$/.test(new URL(body.url).protocol)) {
    ctx.status = 400
    ctx.body = 'A valid http(s) URL is required'
    return
  }
  const matched = (await searchScrapers(body.url)).map(getScraperId)
  if (!matched.length) {
    ctx.status = 422
    ctx.body = 'No scraper matches this URL'
    return
  }
  const added = await addMonitorUrls([{
    url: body.url,
    scraperId: matched[0],
    studio: null,
    network: null,
    source: "manual",
  }])
  // the first scrape sets the baseline and fills in studio and network
  const scrape = added ? await runMonitorScrape((await getMonitorUrl(body.url))!) : null
  // Stash picks randomly between overlapping scrapers, so flag it rather than guess
  ctx.body = { added, scraperId: matched[0], overlap: matched.length > 1 ? matched : null, scrape }
})

router.post("/api/admin/monitor/accept", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  const fields = body?.fields
  if (!body?.url || !Array.isArray(fields) || !fields.length || !fields.every(f => typeof f === "string" && /^\w{1,40}$/.test(f))) {
    ctx.status = 400
    ctx.body = 'A URL and a list of field names are required'
    return
  }
  if (!await acceptMonitorFields(body.url, fields)) {
    ctx.status = 404
    ctx.body = 'URL is not monitored'
    return
  }
  ctx.body = { accepted: fields }
})

// until: ISO date to snooze until, null to unsnooze; one of url or scraperId picks the rows
router.post("/api/admin/monitor/snooze", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  const until = body?.until === null ? null : new Date(body?.until)
  if (!!body?.url === !!body?.scraperId || (until && !(until.getTime() > Date.now()))) {
    ctx.status = 400
    ctx.body = 'Either a URL or a scraper id, plus a future date (or null) are required'
    return
  }
  const matched = await snoozeMonitorUrls(body.url ? { url: body.url } : { scraperId: body.scraperId }, until)
  if (!matched) {
    ctx.status = 404
    ctx.body = 'Nothing monitored matches'
    return
  }
  ctx.body = { snoozed: matched, until }
})

router.delete("/api/admin/monitor/url", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body?.url) {
    ctx.status = 400
    ctx.body = 'URL is required'
    return
  }
  if (!await removeMonitorUrl(body.url)) {
    ctx.status = 404
    ctx.body = 'URL is not monitored'
    return
  }
  ctx.body = { removed: body.url }
})

router.post("/api/admin/monitor/import", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!isValidPackageId(body?.id)) {
    ctx.status = 400
    ctx.body = 'A valid scraper package id is required'
    return
  }
  const md = await fetchOverview(body.id)
  if (md === null) {
    ctx.status = 404
    ctx.body = `${body.id} has no overview.md on CommunityScrapers master`
    return
  }
  const rows = parseOverview(md)
  if (!rows.length) {
    ctx.status = 422
    ctx.body = `No URL rows found in ${body.id}/overview.md`
    return
  }
  // an overview.md can list URLs another scraper claims (e.g. Reptyle's lists SayUncle's), so file each by match
  const index = await fetchScraperIndex()
  const docs = rows.map(row => {
    const matched = matchScrapers(index, row.url).map(getScraperId)
    const scraperId = matched.length && !matched.includes(body.id) ? matched[0] : body.id
    return { ...row, scraperId, source: "overview" as const, overview: body.id }
  })
  const added = await addMonitorUrls(docs)
  const dropped = await syncOverviewRows(body.id, docs.map(doc => doc.url))
  const elsewhere = docs.filter(doc => doc.scraperId !== body.id).length
  ctx.body = { found: rows.length, added, elsewhere, dropped }
})

router.post("/api/admin/monitor/scrape", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  const monitored = body?.url ? await getMonitorUrl(body.url) : null
  if (!monitored) {
    ctx.status = 404
    ctx.body = 'URL is not monitored'
    return
  }
  // a failed scrape is still a completed request: it's stored and shown in the panel
  ctx.body = await runMonitorScrape(monitored)
})

const runMonitorScrape = async (monitored: monitorUrl): Promise<{ jobId: string | null, error: string | null }> => {
  // no apiKey: monitor scrapes don't consume rate-limit credits
  const { body: result } = await getScrapeResult("scene", monitored.url, true)
  const scraped = (result as any)?.result
  if (scraped) {
    // studio/network are filled from the scrape only while empty, so overview.md values win
    await updateMonitorUrl(monitored.url, {
      baseline: nextBaseline(monitored.baseline, scraped),
      studio: monitored.studio ?? scraped.studio?.name ?? null,
      network: monitored.network ?? scraped.studio?.parent?.name ?? null,
    })
  }
  return { jobId: (result as any)?.jobId ?? null, error: (result as any)?.error ?? null }
}

// scraper files with a scheduled scrape in flight
const scheduledBusy = new Set<string>()
// scrapes share one Stash on a small VPS, and unknown scrapers trigger installs, so cap the total
const MAX_SCHEDULED_SCRAPES = 5
// per scraper file; sites only block bursts of several scrapes within seconds
const SCRAPER_GAP = 5 * 60_000
const scheduleTick = async () => {
  const urls = await listMonitorUrls()
  // any stored scrape counts, including public users', so the schedule never piles on top of them
  const lastScraped = new Map((await getLatestResults(urls.map(u => u.url))).map(doc => [doc._id, Date.parse(doc.date) || 0]))
  const DAY = 24 * 3600_000
  for (const url of pickDue(urls, lastScraped, scheduledBusy, Date.now(), 7 * DAY, SCRAPER_GAP, MAX_SCHEDULED_SCRAPES - scheduledBusy.size)) {
    const monitored = urls.find(u => u.url === url)!
    scheduledBusy.add(monitored.scraperId)
    runMonitorScrape(monitored)
      .then(({ error }) => console.log(`Scheduled scrape ${url}: ${error ?? "ok"}`))
      .catch(err => console.error(`Scheduled scrape ${url} failed:`, err))
      .finally(() => scheduledBusy.delete(monitored.scraperId))
  }
}

router.post("/api/admin/apikey/reactivate", koaValidateAdmin, async (ctx) => {
  const body = (ctx.request as any).body
  if (!body || !body.key) {
    ctx.status = 400
    ctx.body = 'API key is required to reactivate'
    return
  }
  await reactivateApiKey(body.key)
  ctx.body = 'API key reactivated successfully'
})

router.post("/api/update", koaValidate, async (ctx) => {
  ctx.body = { updated: await updateScrapersWithDiff() }
})

router.get("/api/validatekey", async (ctx) => {
  const apikeyResponse = await checkKeyValidity(getRequestKey(ctx))
  if (apikeyResponse) {
    ctx.status = 200
    ctx.body = 'API key is valid'
  } else {
    ctx.status = 401
    ctx.body = 'Unauthorized'
  }
})

router.get("/api/result/{*lookup}", async (ctx) => {
  const lookup = ctx.params.lookup
  if (!lookup) {
    ctx.status = 400
    ctx.body = 'Job ID/ URL is required'
    return
  }
  const result = await getResult(lookup)
  if (!result) {
    ctx.status = 404
    ctx.body = 'Job result not found'
    return
  }
  ctx.body = result
})

router.get("/api/scrape/:type/{*url}", koaValidate, async (ctx) => {
  const url = ctx.params.url
  if (!url) {
    ctx.status = 400
    ctx.body = 'URL is required'
    return
  }
  const { status, body } = await getScrapeResult(ctx.params.type, url, false, getRequestKey(ctx))
  ctx.status = status
  ctx.body = body
})

router.post("/api/scrape", koaValidate, async (ctx) => {
  // missing defn patches
  const bodyJSON = (ctx.request as any).body
  if (!bodyJSON || !bodyJSON.url || !bodyJSON.scrapeType) {
    ctx.status = 400
    ctx.body = 'Missing required fields: url, scrapeType'
    return
  }
  if (bodyJSON.scrapeType !== 'scene') {
    ctx.status = 400
    ctx.body = `Invalid scrapeType. Valid types are: scene`
    return
  }
  // async is opt-in so existing synchronous consumers (e.g. the Rescrape
  // userscript) keep getting the full result in the response body
  const scrape = bodyJSON.async ? submitScrape : getScrapeResult
  const { status, body } = await scrape(bodyJSON.scrapeType, bodyJSON.url, bodyJSON.rescrape, getRequestKey(ctx))
  ctx.status = status
  ctx.body = body
})

// Discord slash-command interactions (see src/discord.ts)
router.post("/interactions", async (ctx) => {
  const publicKey = process.env.DISCORD_PUBLIC_KEY
  const signature = ctx.headers['x-signature-ed25519'] as string
  const timestamp = ctx.headers['x-signature-timestamp'] as string
  const rawBody = (ctx.request as any).rawBody
  if (!publicKey || !signature || !timestamp || !rawBody || !await verifyDiscordSignature(publicKey, timestamp, rawBody, signature)) {
    ctx.status = 401
    return
  }
  const { status, json } = await handleInteraction((ctx.request as any).body)
  ctx.status = status
  if (json) ctx.body = json
})

app.use(cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS']
}));
app.use(bodyParser({ parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'] }));
app.use(router.routes()).use(router.allowedMethods());
app.use(serve('public', { extensions: ['html'] }));

// connect db
connect()
  .then(() => createIndex())
  .then(() => console.log("Connected to database"))
  .then(() => {
    // opt-in so local dev never scrapes from a home IP on its own
    if (!process.env.MONITOR_SCHEDULE) return
    // shortcut: in-process timer, fine for one app instance; move to the tester service once lanes exist
    setInterval(() => scheduleTick().catch(err => console.error("Monitor schedule tick failed:", err)), 60_000)
    console.log("Monitor schedule enabled")
  })
  .catch(err => {
    console.error("Failed to connect to database:", err)
    process.exit(1)
  })

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

process.on('SIGINT', function() {
  process.exit()
});
