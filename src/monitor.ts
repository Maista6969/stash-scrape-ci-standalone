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
