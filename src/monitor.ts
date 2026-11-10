import axios from "axios"

export type monitorStatus = "never" | "running" | "error" | "regressed" | "suspect" | "ok" | "snoozed"

// fields a scene result actually returned; empty strings and arrays count as missing
export const presentFields = (result: Record<string, unknown> | null | undefined): string[] =>
  Object.entries(result ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k)
    .sort()

// missing: fields this URL's own baseline had (a regression). suspect: fields every sibling URL of
// its scraper returns but this one never has, e.g. a field already broken when this URL's baseline
// formed; only a hint, since a scene can genuinely lack a field, so accepted ones are ignored
export const classify = (
  latest: { error?: string | null, pending?: boolean | null, result?: Record<string, unknown> | null } | undefined,
  baseline: string[] | null,
  siblings: string[] = [],
  accepted: string[] = [],
): { status: monitorStatus, missing: string[], suspect: string[] } => {
  if (!latest) return { status: "never", missing: [], suspect: [] }
  if (latest.pending) return { status: "running", missing: [], suspect: [] }
  if (latest.error) return { status: "error", missing: [], suspect: [] }
  const present = presentFields(latest.result)
  // Stash reports a scrape that found nothing as a success
  if (!present.length) return { status: "error", missing: baseline ?? [], suspect: [] }
  const missing = (baseline ?? []).filter(f => !present.includes(f))
  const suspect = siblings.filter(f => !present.includes(f) && !baseline?.includes(f) && !accepted.includes(f))
  return { status: missing.length ? "regressed" : suspect.length ? "suspect" : "ok", missing, suspect }
}

// a snoozed failure is hidden, not fixed: the URL keeps being scraped and the flag returns when the snooze lapses
export const applySnooze = <T extends { status: monitorStatus }>(verdict: T, snoozedUntil: Date | null | undefined, now = new Date()): T =>
  snoozedUntil && snoozedUntil > now && ["error", "regressed", "suspect"].includes(verdict.status)
    ? { ...verdict, status: "snoozed" }
    : verdict

// fields in every sibling's baseline; needs two siblings so one URL can't speak for a whole scraper
export const siblingFields = (siblingBaselines: (string[] | null)[]): string[] => {
  const known = siblingBaselines.filter((b): b is string[] => !!b?.length)
  if (known.length < 2) return []
  return known.reduce((common, b) => common.filter(f => b.includes(f)))
}


// only a non-regressed scrape moves the baseline, so a dropped field stays
// flagged until it comes back or the URL is removed and re-added
export const nextBaseline = (baseline: string[] | null, result: Record<string, unknown> | null | undefined): string[] | null => {
  const present = presentFields(result)
  if (!present.length) return baseline
  return (baseline ?? []).every(f => present.includes(f)) ? present : baseline
}

// overview.md files have one table with Studio and URL columns, plus an optional Network column
export const parseOverview = (md: string): { url: string, studio: string | null, network: string | null }[] => {
  const rows = md.split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("|"))
    .map(line => line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map(cell => cell.trim()))
  if (rows.length < 3) return []
  const header = rows[0].map(cell => cell.toLowerCase())
  const urlCol = header.indexOf("url")
  if (urlCol === -1) return []
  const cell = (row: string[], name: string) => row[header.indexOf(name)] || null
  return rows.slice(2)
    .filter(row => /^https?:\/\/\S+$/.test(row[urlCol] ?? ""))
    .map(row => ({ url: row[urlCol], studio: cell(row, "studio"), network: cell(row, "network") }))
}

export const isValidPackageId = (id: unknown): id is string =>
  typeof id === "string" && /^[\w.&-]+$/.test(id) && !id.includes("..")

// null when the scraper has no overview.md on CommunityScrapers master
export const fetchOverview = async (scraperId: string): Promise<string | null> => {
  const rawURL = `https://raw.githubusercontent.com/stashapp/CommunityScrapers/master/scrapers/${encodeURIComponent(scraperId)}/overview.md`
  return axios.get(rawURL, { responseType: "text" })
    .then(res => res.data as string)
    .catch(err => {
      if (err.response?.status === 404) return null
      throw err
    })
}

// a scraper file is one backend: at most one of its URLs per pick, none while it's busy or
// scraped within gapMs, and of its URLs the one scraped longest ago once intervalMs old.
// slots caps the pick so the scraping host isn't flooded; the most overdue go first
export const pickDue = (
  urls: { url: string, scraperId: string }[],
  lastScraped: Map<string, number>,
  busy: Set<string>,
  now: number,
  intervalMs: number,
  gapMs: number,
  slots: number,
): string[] => {
  const byScraper = new Map<string, { url: string, last: number }[]>()
  for (const { url, scraperId } of urls) {
    byScraper.set(scraperId, [...byScraper.get(scraperId) ?? [], { url, last: lastScraped.get(url) ?? 0 }])
  }
  const due: { url: string, last: number }[] = []
  for (const [scraperId, entries] of byScraper) {
    if (busy.has(scraperId)) continue
    if (now - Math.max(...entries.map(e => e.last)) < gapMs) continue
    const oldest = entries.reduce((a, b) => (b.last < a.last ? b : a))
    if (now - oldest.last >= intervalMs) due.push(oldest)
  }
  return due.sort((a, b) => a.last - b.last).slice(0, Math.max(0, slots)).map(e => e.url)
}

export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "")

// per scraper package: how many monitored URLs it has and how many of its domains they reach
export const coverage = (
  scrapers: { scraperId: string, name: string, hosts: string[] }[],
  urls: { url: string, scraperId: string }[],
): { scraperId: string, names: string[], hosts: number, coveredHosts: number, urls: number }[] => {
  const packages = new Map<string, { names: string[], hosts: Set<string> }>()
  for (const { scraperId, name, hosts } of scrapers) {
    const pkg = packages.get(scraperId) ?? { names: [], hosts: new Set<string>() }
    pkg.names.push(name)
    for (const host of hosts) pkg.hosts.add(bareHost(host))
    packages.set(scraperId, pkg)
  }
  return [...packages].map(([scraperId, { names, hosts }]) => {
    const own = urls.filter(u => u.scraperId === scraperId)
    const reached = new Set(own.map(u => bareHost(new URL(u.url).hostname)))
    return { scraperId, names, hosts: hosts.size, coveredHosts: [...hosts].filter(h => reached.has(h)).length, urls: own.length }
  })
}

let overviewCache: { at: number, ids: Set<string> } | null = null
// one tree listing instead of a request per scraper; cached because unauthenticated GitHub API calls are capped at 60/h
export const fetchOverviewIds = async (): Promise<Set<string>> => {
  if (overviewCache && Date.now() - overviewCache.at < 3600_000) return overviewCache.ids
  const { data } = await axios.get("https://api.github.com/repos/stashapp/CommunityScrapers/git/trees/master?recursive=1")
  const ids = new Set<string>((data.tree as { path: string }[])
    .map(t => t.path.match(/^scrapers\/([^/]+)\/overview\.md$/)?.[1])
    .filter((id): id is string => !!id))
  overviewCache = { at: Date.now(), ids }
  return ids
}
