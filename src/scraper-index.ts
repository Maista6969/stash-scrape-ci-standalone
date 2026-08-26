// import types from scraper index
import { scraperExport } from "../types/scraperIndex.js";
import axios from "axios";
import { StashApp } from "./stash-app.js";

// scraper index searcher and installer
async function searchScrapers(url: string): Promise<scraperExport[]> {
  // fetch communityScrapers
  const communityScrapers = await axios
    .get("https://stashapp.github.io/CommunityScrapers/assets/scrapers.json")
    .then((res) => res.data as scraperExport[]);
  // find scrapers that match URL
  return communityScrapers.filter((scraper) =>
    scraper.sites.some((pattern) => url.includes(pattern)),
  );
}

const getScraperId = (scraper: scraperExport): string =>
  scraper.filename
    .replace("../scrapers/", "")
    .replace(".yml", "")
    .split("/")[0];

async function installSharedDependencies(
  scraper: scraperExport,
  stash: StashApp,
  existingScrapers: string[],
): Promise<void> {
  const rawURL = `https://raw.githubusercontent.com/stashapp/CommunityScrapers/master/${scraper.filename.replace("../", "")}`;
  const source: string = await axios
    .get(rawURL)
    .then((res) => res.data)
    .catch(() => "");
  const match = source.match(/^#\s*requires:\s*(.+)$/m);
  if (!match) return;
  const requiredPackages = match[1]
    .split(",")
    .map((pkg) => pkg.trim())
    .filter(Boolean);
  for (const pkg of requiredPackages) {
    if (existingScrapers.includes(pkg)) continue;
    console.log(`Installing shared dependency: ${pkg}`);
    const jobId = await stash.installPackage(pkg);
    await stash.awaitJobFinished(jobId);
  }
}

// handle url scrapersearch
export async function scraperSearch(
  url: string,
  stash: StashApp,
): Promise<{ error: string } | { success: string; id: string }> {
  // search in CommunityScrapers
  const matchedScrapers = await searchScrapers(url);
  // if no results, return empty array
  if (matchedScrapers.length === 0)
    return { error: "No scrapers found for the provided URL." };
  // check for existing scrapers
  const existingScrapers = await stash.getExistingScrapers();
  // check against IDs
  const hasExistingScrapers = matchedScrapers
    .map(getScraperId)
    .filter((id) => existingScrapers.includes(id));
  // if no existing and only one matched, install it
  if (hasExistingScrapers.length === 0 && matchedScrapers.length === 1) {
    const scraper = matchedScrapers[0];
    const scraperId = getScraperId(scraper);
    console.log(`Installing scraper: ${scraperId}`);
    const jobId = await stash.installPackage(scraperId);
    await stash.awaitJobFinished(jobId);
    await installSharedDependencies(scraper, stash, existingScrapers);
    return {
      success: `Scraper ${scraperId} installed successfully.`,
      id: scraperId,
    };
  } else if (matchedScrapers.length > 1 && hasExistingScrapers.length === 0) {
    // if multiple, don't install
    return {
      error:
        "Multiple scrapers found for the provided URL. Cowardly refusing to install.",
    };
  } else if (hasExistingScrapers.length == 1) {
    // if one existing, return success
    return {
      success: `Scraper ${hasExistingScrapers[0]} already installed.`,
      id: hasExistingScrapers[0],
    };
  } else {
    return {
      success: "Multiple scrapers already installed",
      id: hasExistingScrapers[1],
    };
  }
}
