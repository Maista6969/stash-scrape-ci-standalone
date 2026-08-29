// imports
import { connect, createIndex, getResult, createApiKey, revokeApiKey, reactivateApiKey, listApiKeys, listRecentScrapes } from "./db.js"
import { StashApp } from "./stash-app.js"
import { helpText } from "./utils.js"
import { keyStatus, checkKeyLimit, checkKeyValidity, getKeyUsage } from "./apikey.js"
import 'dotenv/config'

import Koa from "koa"
const app = new Koa()
import cors from '@koa/cors';
import bodyParser from "@koa/bodyparser";
import serve from 'koa-static';

import Router from '@koa/router';
import { getScrapeResult } from "./scrape.js"
import { verifyDiscordSignature, handleInteraction } from "./discord.js"
const router = new Router();

// apikey validatorv
const koaValidate = async (ctx: Koa.Context, next: Koa.Next) => {
  // missing definition patches
  const apiKey = (ctx.request as any).body?.auth || ctx.query.auth || ctx.headers['x-api-key']
  const apikeyResponse = await checkKeyLimit(apiKey)
  if (apikeyResponse === keyStatus.invalid) {
    ctx.status = 401
    ctx.body = 'Unauthorized'
    return
  } else if (apikeyResponse === keyStatus.exhausted) {
    ctx.status = 429
    ctx.body = 'API key rate limit exceeded'
    return
  }
  return next()
}

const koaValidateAdmin = async (ctx: Koa.Context, next: Koa.Next) => {
  const apikey = (ctx.request as any).body?.auth || ctx.query.auth || ctx.headers['x-api-key']
  if (apikey !== process.env.ADMIN_KEY) {
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
  const stash = new StashApp()
  await stash.migrateDatabase()
  await stash.checkUpdatePackages(true)
  ctx.body = 'Scrapers updated successfully'
})

router.get("/api/validatekey", async (ctx) => {
  const apiKey = (ctx.request as any).body?.auth || ctx.query.auth || ctx.headers['x-api-key']
  const apikeyResponse = await checkKeyValidity(apiKey)
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
  const { status, body } = await getScrapeResult(ctx.params.type, url)
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
  const { status, body } = await getScrapeResult(bodyJSON.scrapeType, bodyJSON.url, bodyJSON.rescrape)
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
