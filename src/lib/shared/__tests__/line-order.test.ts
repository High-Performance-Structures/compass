import { describe, expect, it } from "vitest"

import { moveLine, sortLinesByCostCode } from "@/lib/shared/line-order"

describe("line order", () => {
  it("moves a line up or down and ignores moves off the ends", () => {
    expect(moveLine(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
    expect(moveLine(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"])
    const same = ["a", "b"]
    expect(moveLine(same, 1, 2)).toBe(same)
    expect(moveLine(same, -1, 0)).toBe(same)
  })

  it("sorts by cost code numerically, blanks last, ties stay put", () => {
    const lines = [
      { id: "1", code: "10-100" },
      { id: "2", code: "" },
      { id: "3", code: "2-100" },
      { id: "4", code: "2-100" },
      { id: "5", code: null },
    ]
    expect(sortLinesByCostCode(lines, (line) => line.code).map((line) => line.id)).toEqual(["3", "4", "1", "2", "5"])
  })
})
