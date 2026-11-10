import { describe, expect, it } from "vitest"

import { recordStep } from "@/lib/shared/record-step"

describe("recordStep", () => {
  const ids = ["a", "b", "c"] as const

  it("steps to both neighbours in the middle of the list", () => {
    expect(recordStep(ids, "b")).toEqual({ kind: "listed", position: 2, total: 3, previousId: "a", nextId: "c" })
  })

  it("has no previous record at the start", () => {
    expect(recordStep(ids, "a")).toEqual({ kind: "listed", position: 1, total: 3, previousId: null, nextId: "b" })
  })

  it("has no next record at the end", () => {
    expect(recordStep(ids, "c")).toEqual({ kind: "listed", position: 3, total: 3, previousId: "b", nextId: null })
  })

  it("has neither neighbour when the open record is the only one", () => {
    expect(recordStep(["a"], "a")).toEqual({ kind: "listed", position: 1, total: 1, previousId: null, nextId: null })
  })

  it("reports a record filtered out of the list, or none open, as unlisted", () => {
    expect(recordStep(ids, "z")).toEqual({ kind: "unlisted", total: 3 })
    expect(recordStep(ids, null)).toEqual({ kind: "unlisted", total: 3 })
    expect(recordStep([], "a")).toEqual({ kind: "unlisted", total: 0 })
  })
})
