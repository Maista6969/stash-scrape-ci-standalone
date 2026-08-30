import { MongoClient } from "mongodb";
import { genID } from "./utils.js"

const uri = process.env.MONGODB_URI || "mongodb://mongodb:27017/stash-ci";
const client = new MongoClient(uri);

const db = client.db();
const sceneCollection = db.collection("scene");
const apiKeyCollection = db.collection("apiKeys");

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
}

export async function getResult(lookup: string) {
  const doc = await sceneCollection.find({ $or: [{ jobId: lookup }, { url: lookup }] }).sort({ "_id": -1 }).limit(1).next();
  return doc ? doc : null;
}

export async function addResult(cachedResult: any, url: string) {
  await sceneCollection.insertOne({
    url,
    ...cachedResult
  });
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
