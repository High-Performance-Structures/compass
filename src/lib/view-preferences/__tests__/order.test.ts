import { describe, expect, it } from "vitest"
import { applySavedOrder, parseSavedOrder } from "@/lib/view-preferences/order"

const items = [{ id: "schedule" }, { id: "contacts" }, { id: "field" }, { id: "budget" }]

describe("applySavedOrder", () => {
  it("keeps the default order when nothing is saved", () => {
    expect(applySavedOrder(items, [])).toBe(items)
  })

  it("puts saved ids first and appends new items in default order", () => {
    expect(applySavedOrder(items, ["field", "schedule"]).map((item) => item.id)).toEqual(["field", "schedule", "contacts", "budget"])
  })

  it("ignores saved ids that no longer exist", () => {
    expect(applySavedOrder(items, ["gone", "budget"]).map((item) => item.id)).toEqual(["budget", "schedule", "contacts", "field"])
  })
})

describe("parseSavedOrder", () => {
  it("accepts unique strings and rejects bad input", () => {
    expect(parseSavedOrder('["a","b","a",3]')).toEqual(["a", "b"])
    expect(parseSavedOrder("not json")).toEqual([])
    expect(parseSavedOrder(null)).toEqual([])
  })
})
