import { test } from "node:test"
import assert from "node:assert/strict"
import { classify, nextBaseline, parseOverview, presentFields, isValidPackageId } from "./monitor.js"

test("presentFields ignores empty values", () => {
  assert.deepEqual(presentFields({ title: "a", details: "", tags: [], studio: { name: "s" }, code: null }), ["studio", "title"])
})

test("a dropped field stays flagged until it returns", () => {
  let baseline = nextBaseline(null, { title: "a", image: "x" })
  assert.deepEqual(baseline, ["image", "title"])
  const broken = { title: "a" }
  assert.deepEqual(classify({ result: broken }, baseline), { status: "regressed", missing: ["image"] })
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
