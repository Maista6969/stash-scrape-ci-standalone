import { scraperPackage } from "../types/scraperIndex.js";
import { StashApp } from "./stash-app.js";

// Stash already downloads and parses CommunityScrapers' index.yml, so ask it rather than parse YAML here
export const fetchScraperIndex = (): Promise<scraperPackage[]> => new StashApp().availableScrapers();

export const matchScrapers = (index: scraperPackage[], url: string): scraperPackage[] =>
  index.filter((scraper) => scraper.sites.some((pattern) => url.includes(pattern)));

export async function searchScrapers(url: string): Promise<scraperPackage[]> {
  return matchScrapers(await fetchScraperIndex(), url);
}

// Stash's installPackages doesn't pull in `requires` itself; its UI does that client-side
async function installSharedDependencies(
  scraper: scraperPackage,
  stash: StashApp,
  existingScrapers: string[],
): Promise<void> {
  for (const pkg of scraper.requires) {
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
): Promise<{ error: string } | { success: string; id: string; name: string }> {
  // search in CommunityScrapers
  const matchedScrapers = await searchScrapers(url);
  // if no results, return empty array
  if (matchedScrapers.length === 0)
    return { error: "No scrapers found for the provided URL." };
  // check for existing scrapers
  const existingScrapers = await stash.getExistingScrapers();
  // check against IDs
  const hasExistingScrapers = matchedScrapers
    .map((scraper) => scraper.id)
    .filter((id) => existingScrapers.includes(id));
  const nameForId = (id: string): string =>
    matchedScrapers.find((scraper) => scraper.id === id)?.name ??
    id;
  // if no existing and only one matched, install it
  if (hasExistingScrapers.length === 0 && matchedScrapers.length === 1) {
    const scraper = matchedScrapers[0];
    const scraperId = scraper.id;
    console.log(`Installing scraper: ${scraperId}`);
    const jobId = await stash.installPackage(scraperId);
    await stash.awaitJobFinished(jobId);
    await installSharedDependencies(scraper, stash, existingScrapers);
    return {
      success: `Scraper ${scraperId} installed successfully.`,
      id: scraperId,
      name: scraper.name,
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
      name: nameForId(hasExistingScrapers[0]),
    };
  } else {
    return {
      success: "Multiple scrapers already installed",
      id: hasExistingScrapers[1],
      name: nameForId(hasExistingScrapers[1]),
    };
  }
}
