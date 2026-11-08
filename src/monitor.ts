import axios from "axios"

export type monitorStatus = "never" | "running" | "error" | "regressed" | "ok"

// fields a scene result actually returned; empty strings and arrays count as missing
export const presentFields = (result: Record<string, unknown> | null | undefined): string[] =>
  Object.entries(result ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k)
    .sort()

export const classify = (
  latest: { error?: string | null, pending?: boolean | null, result?: Record<string, unknown> | null } | undefined,
  baseline: string[] | null,
): { status: monitorStatus, missing: string[] } => {
  if (!latest) return { status: "never", missing: [] }
  if (latest.pending) return { status: "running", missing: [] }
  if (latest.error) return { status: "error", missing: [] }
  const present = presentFields(latest.result)
  const missing = (baseline ?? []).filter(f => !present.includes(f))
  return { status: missing.length ? "regressed" : "ok", missing }
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
