import { logEntry } from "./stashapp.js";

export interface partialJobResult {
  result?: cleanSceneResult;
  error?: string;
  runnerInfo: runnerInfo;
  stashInfo: stashInfo;
}

export interface jobResult {
  result: cleanSceneResult;
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

export interface stashInfo {
  version: string;
  hash: string;
}

export interface sceneResult {
  title: string;
  code: string;
  date: string;
  director: string;
  duration: string;
  details: string;
  urls: string[];
  performers: { name: string }[];
  studio: { name: string }[];
  groups: { name: string }[];
  movies: { name: string }[];
  tags: { name: string }[];
}

export interface cleanSceneResult {
  title: string;
  code: string | null;
  date: string | null;
  director: string | null;
  duration: string | null;
  details: string | null;
  image: string | null;
  urls: string[] | null;
  performers: string[] | null;
  studio: string | null;
  groups: string[] | null;
  movies: string[] | null;
  tags: string[];
}
