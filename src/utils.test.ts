import { test } from "node:test"
import assert from "node:assert/strict"
import { serialized } from "./utils.js"

test("serialized runs calls one at a time, even after a failure", async () => {
  const order: string[] = []
  const job = (name: string, ms: number, fail = false) => serialized(async () => {
    order.push(`${name} start`)
    await new Promise(r => setTimeout(r, ms))
    order.push(`${name} end`)
    if (fail) throw new Error(name)
  })
  await Promise.allSettled([job("a", 20, true), job("b", 5), job("c", 1)])
  assert.deepEqual(order, ["a start", "a end", "b start", "b end", "c start", "c end"])
})
