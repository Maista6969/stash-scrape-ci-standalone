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

// db structure
// maintain seperate collection for each entity type
// performer, scene, gallery, image, group
// index by URL and jobId

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
export const createApiKey = async (note: string, limit: number = 200): Promise<string> => {
  const apikey = `ssci_${genID(32)}`
  // store in db with note
  apiKeyCollection.insertOne({ apikey, note, createdAt: new Date(), limit });
  return apikey;
}

export const validateApiKey = async (key: string): Promise<number> => {
  const match = await apiKeyCollection.findOne({ apikey: key });
  return match?.limit ?? 0;
}

export const revokeApiKey = async (key: string): Promise<void> => {
  await apiKeyCollection.deleteOne({ apikey: key });
}
