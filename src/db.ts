import { MongoClient } from "mongodb";
import { genID } from "./utils.js"

const uri = process.env.MONGODB_URI || "mongodb://mongodb:27017/stash-ci";
const client = new MongoClient(uri);

const db = client.db();
const sceneCollection = db.collection("scene");
const apiKeyCollection = db.collection("apiKeys");
const monitorUrlCollection = db.collection("monitorUrls");

export async function connect() {
  await client.connect();
  const db = client.db("stash-ci");
  return db;
}

export async function createIndex() {
  // create indexes for each collection=
  await sceneCollection.createIndex({ url: 1 });
  await sceneCollection.createIndex({ jobId: 1 }, { unique: true });
  // apikey
  await apiKeyCollection.createIndex({ apikey: 1 }, { unique: true });
  await apiKeyCollection.createIndex({ discordUserId: 1 }, { unique: true, sparse: true });
  // monitor
  await monitorUrlCollection.createIndex({ url: 1 }, { unique: true });
}

export async function getResult(lookup: string) {
  const doc = await sceneCollection.find({ $or: [{ jobId: lookup }, { url: lookup }] }).sort({ "_id": -1 }).limit(1).next();
  return doc ? doc : null;
}

// only successful scrapes count as cache hits — stored failures and pending
// jobs must not suppress a retry
export async function getCachedResult(url: string) {
  return sceneCollection.find({ url, error: null, pending: null }).sort({ "_id": -1 }).limit(1).next();
}

export async function addResult(cachedResult: any, url: string) {
  await sceneCollection.insertOne({
    url,
    ...cachedResult
  });
}

// placeholder inserted at submit time so /api/result/:jobId resolves while the
// background scrape runs
export async function addPendingResult(jobId: string, url: string, runnerInfo: object) {
  await sceneCollection.insertOne({ url, jobId, pending: true, runnerInfo });
}

export async function completePendingResult(jobId: string, cachedResult: any, url: string) {
  await sceneCollection.replaceOne({ jobId }, { url, ...cachedResult });
}

export async function listRecentScrapes(limit: number = 20) {
  return sceneCollection.find()
    .project({ url: 1, jobId: 1, "result.title": 1, "runnerInfo.scrapeType": 1, "runnerInfo.date": 1 })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
}

// config
// stores scraperLastUpdate timestamp
export const configCollection = db.collection("config");
export const getLastScraperUpdate = async (): Promise<boolean> => {
  const doc = await configCollection.findOne({ key: "scraperLastUpdate" });
  // time greater than 24 hours ago
  return doc ? new Date(doc.value).getTime() > new Date().getTime() - 1000 * 60 * 60 * 24 : false;
}
export const setLastScraperUpdate = async () => {
  await configCollection.updateOne(
    { key: "scraperLastUpdate" },
    { $set: { value: new Date().toISOString() } },
    { upsert: true }
  );
}

// apikey
export const createApiKey = async (note: string, limit: number = 200, discordUserId?: string): Promise<string> => {
  const apikey = `ssci_${genID(32)}`
  // store in db with note
  await apiKeyCollection.insertOne({
    apikey, note, createdAt: new Date(), limit, active: true, revokedAt: null,
    ...(discordUserId ? { discordUserId } : {}),
  });
  return apikey;
}

export const validateApiKey = async (key: string): Promise<number> => {
  const match = await apiKeyCollection.findOne({ apikey: key });
  return match?.active ? match.limit ?? 0 : 0;
}

// self-serve keys provisioned via the Discord /scrape_auth command
export const getApiKeyByDiscordUser = async (discordUserId: string): Promise<{ apikey: string, limit: number, active: boolean } | null> => {
  const match = await apiKeyCollection.findOne({ discordUserId });
  return match ? { apikey: match.apikey, limit: match.limit, active: match.active } : null;
}

export const listApiKeys = async (): Promise<{ apikey: string, note: string, limit: number, createdAt: Date, active: boolean, revokedAt: Date | null }[]> => {
  return apiKeyCollection.find().sort({ createdAt: -1 }).toArray() as any;
}

// revoke/reactivate keep the document (and its usage history) around instead of deleting it
export const revokeApiKey = async (key: string): Promise<void> => {
  await apiKeyCollection.updateOne({ apikey: key }, { $set: { active: false, revokedAt: new Date() } });
}

export const reactivateApiKey = async (key: string): Promise<void> => {
  await apiKeyCollection.updateOne({ apikey: key }, { $set: { active: true, revokedAt: null } });
}

// monitor
export interface monitorUrl {
  url: string;
  scraperId: string;
  studio: string | null;
  network: string | null;
  source: "overview" | "manual" | "auto";
  addedAt: Date;
  baseline: string[] | null; // fields present in the last non-regressed scrape
  accepted?: string[]; // fields a sibling-based "suspect" flag was dismissed for
}

export const listMonitorUrls = async (): Promise<monitorUrl[]> => {
  return monitorUrlCollection.find().project({ _id: 0 }).toArray() as any;
}

// $setOnInsert so re-importing an overview.md leaves existing rows and their baselines alone
export const addMonitorUrls = async (docs: Omit<monitorUrl, "addedAt" | "baseline">[]): Promise<number> => {
  if (!docs.length) return 0
  const res = await monitorUrlCollection.bulkWrite(docs.map(doc => ({
    updateOne: {
      filter: { url: doc.url },
      update: { $setOnInsert: { ...doc, addedAt: new Date(), baseline: null } },
      upsert: true,
    }
  })))
  return res.upsertedCount
}

export const getMonitorUrl = async (url: string): Promise<monitorUrl | null> => {
  return monitorUrlCollection.findOne({ url }, { projection: { _id: 0 } }) as any;
}

export const removeMonitorUrl = async (url: string): Promise<boolean> => {
  return (await monitorUrlCollection.deleteOne({ url })).deletedCount > 0
}

export const acceptMonitorFields = async (url: string, fields: string[]): Promise<boolean> =>
  (await monitorUrlCollection.updateOne({ url }, { $addToSet: { accepted: { $each: fields } } })).matchedCount > 0

export const updateMonitorUrl = async (url: string, fields: Partial<Pick<monitorUrl, "baseline" | "studio" | "network">>): Promise<void> => {
  await monitorUrlCollection.updateOne({ url }, { $set: fields })
}

// latest scrape per URL from any source (panel or public users); logs are
// dropped before the sort so the in-memory sort stays small
export const getLatestResults = async (urls: string[]) => {
  return sceneCollection.aggregate([
    { $match: { url: { $in: urls } } },
    { $project: { logs: 0, stashInfo: 0 } },
    { $sort: { _id: -1 } },
    { $group: {
      _id: "$url",
      jobId: { $first: "$jobId" },
      error: { $first: "$error" },
      pending: { $first: "$pending" },
      result: { $first: "$result" },
      scraperId: { $first: "$runnerInfo.scraperId" },
      date: { $first: "$runnerInfo.date" },
    } },
  ], { allowDiskUse: true }).toArray()
}
