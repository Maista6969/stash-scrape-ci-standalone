import { test } from "node:test"
import assert from "node:assert/strict"
import { classify, nextBaseline, parseOverview, presentFields, isValidPackageId, pickDue, coverage, siblingFields } from "./monitor.js"

test("presentFields ignores empty values", () => {
  assert.deepEqual(presentFields({ title: "a", details: "", tags: [], studio: { name: "s" }, code: null }), ["studio", "title"])
})

test("a dropped field stays flagged until it returns", () => {
  let baseline = nextBaseline(null, { title: "a", image: "x" })
  assert.deepEqual(baseline, ["image", "title"])
  const broken = { title: "a" }
  assert.deepEqual(classify({ result: broken }, baseline), { status: "regressed", missing: ["image"], suspect: [] })
  baseline = nextBaseline(baseline, broken)
  assert.deepEqual(classify({ result: broken }, baseline).status, "regressed")
  baseline = nextBaseline(baseline, { title: "b", image: "y", date: "2026" })
  assert.deepEqual(baseline, ["date", "image", "title"])
})

test("errors and pending scrapes never move the baseline", () => {
  assert.deepEqual(nextBaseline(["title"], undefined), ["title"])
  assert.equal(classify({ error: "boom" }, ["title"]).status, "error")
  assert.equal(classify({ pending: true }, ["title"]).status, "running")
  assert.equal(classify(undefined, null).status, "never")
})

test("parseOverview handles all three table layouts", () => {
  const studioOnly = `Scraper has been tested on 2026-08-31

| Studio    | URL                       |
| :-------- | :------------------------ |
| 18 Virgin | https://a.com/episode/1/  |
`
  assert.deepEqual(parseOverview(studioOnly), [{ url: "https://a.com/episode/1/", studio: "18 Virgin", network: null }])
  const withNetwork = `| Network | Studio | URL |
| --- | --- | --- |
| Net | Stu | https://b.com/x |
| Net | Bad | not a url |`
  assert.deepEqual(parseOverview(withNetwork), [{ url: "https://b.com/x", studio: "Stu", network: "Net" }])
  const withScraper = `| Studio | URL | Scraper |
| :-- | :-- | :-- |
| CFNM | https://c.com/s.html | oldStyle |`
  assert.deepEqual(parseOverview(withScraper), [{ url: "https://c.com/s.html", studio: "CFNM", network: null }])
  assert.deepEqual(parseOverview("no table here"), [])
})

test("package ids allow dots and ampersands but not traversal", () => {
  assert.ok(isValidPackageId("R18.dev"))
  assert.ok(isValidPackageId("Babes&Stars"))
  assert.ok(!isValidPackageId(".."))
  assert.ok(!isValidPackageId("a/b"))
  assert.ok(!isValidPackageId(undefined))
})

test("pickDue serializes and spaces each scraper file", () => {
  const H = 3600_000, D = 24 * H, now = 30 * D
  const urls = [
    { url: "a1", scraperId: "A" }, { url: "a2", scraperId: "A" },
    { url: "b1", scraperId: "B" },
    { url: "c1", scraperId: "C" },
    { url: "d1", scraperId: "D" },
  ]
  const last = new Map([
    ["a1", now - 10 * D],            // A: a2 never scraped, so it goes first
    ["b1", now - 8 * D],             // B: due
    ["c1", now - 3 * D],             // C: scraped within the week
  ])
  assert.deepEqual(pickDue(urls, last, new Set(["D"]), now, 7 * D, H, 5), ["a2", "b1"])
  last.set("a2", now - 30 * 60_000)  // A scraped half an hour ago: a1 is due but must wait out the gap
  assert.deepEqual(pickDue(urls, last, new Set(), now, 7 * D, H, 5), ["d1", "b1"])
  // slots cap the pick, most overdue first (d1 was never scraped)
  assert.deepEqual(pickDue(urls, last, new Set(), now, 7 * D, H, 1), ["d1"])
  assert.deepEqual(pickDue(urls, last, new Set(), now, 7 * D, H, 0), [])
})

test("coverage counts URLs and reached domains per package", () => {
  const scrapers = [
    { scraperId: "Net", name: "Net A", hosts: ["a.com", "www.b.com"] },
    { scraperId: "Net", name: "Net B", hosts: ["c.com"] },
    { scraperId: "Lone", name: "Lone", hosts: ["lone.com"] },
  ]
  const urls = [
    { url: "https://www.a.com/x", scraperId: "Net" },
    { url: "https://a.com/y", scraperId: "Net" },
    { url: "https://b.com/z", scraperId: "Net" },
    { url: "https://lone.com/1", scraperId: "Other" },
  ]
  assert.deepEqual(coverage(scrapers, urls), [
    { scraperId: "Net", names: ["Net A", "Net B"], hosts: 3, coveredHosts: 2, urls: 3 },
    { scraperId: "Lone", names: ["Lone"], hosts: 1, coveredHosts: 0, urls: 0 },
  ])
})

test("an empty result is an error even without a baseline", () => {
  const empty = { title: null, details: null, tags: [] }
  assert.deepEqual(classify({ result: empty }, null), { status: "error", missing: [], suspect: [] })
  assert.deepEqual(classify({ result: empty }, ["title"]), { status: "error", missing: ["title"], suspect: [] })
  assert.equal(nextBaseline(null, empty), null)
})

test("a field broken since this URL's first scrape is suspect through its siblings", () => {
  const full = ["date", "details", "image", "title"]
  // details selector broke before this URL was added, so its own baseline never had it
  const own = ["date", "image", "title"]
  const scraped = { date: "d", image: "i", title: "t" }
  assert.deepEqual(classify({ result: scraped }, own, siblingFields([full, full])),
    { status: "suspect", missing: [], suspect: ["details"] })
  // accepting it (the scene really has no details) clears it
  assert.equal(classify({ result: scraped }, own, siblingFields([full, full]), ["details"]).status, "ok")
  // an own-baseline drop outranks a sibling hint
  assert.equal(classify({ result: { date: "d", title: "t" } }, own, full).status, "regressed")
  // a field one sibling legitimately lacks (e.g. a studio without codes) isn't expected
  assert.deepEqual(siblingFields([[...full, "code"], full]), full)
  // one sibling (or none with a baseline) isn't enough to set expectations
  assert.deepEqual(siblingFields([full]), [])
  assert.deepEqual(siblingFields([full, null]), [])
})
