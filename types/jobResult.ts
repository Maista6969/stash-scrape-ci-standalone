import { logEntry } from "./stashapp.js";

export interface partialJobResult {
  result?: sceneResult;
  error?: string;
  runnerInfo: runnerInfo;
  stashInfo: stashInfo;
}

export interface jobResult {
  result: sceneResult;
  runnerInfo: runnerInfo;
  stashInfo: stashInfo;
  jobId: string; // nanoid generated id with limited alphabet
  logs: logEntry[];
}

export interface runnerInfo {
  scraperId?: string;
  scraperVersion?: string;
  url: string;
  scrapeType: "scene";
  date: string; // ISO date string
}

// matches the shape of Stash's `{ version { version hash } }` GraphQL query
// (see getStashInfo in stash-app.ts), not a flat { version, hash }
export interface stashInfo {
  version: {
    version: string;
    hash: string;
  };
}

// mirrors Stash's own ScrapedScene shape (relational fields stay as
// objects, e.g. `{ name }`), rather than flattening them to strings
export interface sceneResult {
  title: string;
  code: string | null;
  date: string | null;
  director: string | null;
  duration: string | null;
  details: string | null;
  image: string | null;
  urls: string[] | null;
  performers: { name: string; gender: string | null }[] | null;
  studio: { name: string; parent: { name: string } | null } | null;
  groups: { name: string }[] | null;
  movies: { name: string }[] | null;
  tags: { name: string }[] | null;
}
