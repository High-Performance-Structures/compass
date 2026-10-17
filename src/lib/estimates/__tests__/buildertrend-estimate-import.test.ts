import { describe, expect, it } from "vitest"
import { parseBuildertrendCostCode, parseBuildertrendEstimateRows } from "@/lib/estimates/buildertrend-estimate-import"

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Cost Code": "03 21 00 - Reinforcing Steel",
    Title: "#4 rebar",
    "Parent Group": "Footings",
    "Parent Group Description": "Labor and materials for footings",
    Subgroup: "",
    "Option Type": "",
    Quantity: 10,
    Unit: "EA",
    "Unit Cost": 23.53,
    "Builder Cost": 235.3,
    Markup: 26,
    "Markup Type": "%",
    "Total Price": 296.48,
    "Tax Amount": 0,
    "Cost Type": "Material",
    "Internal Notes": "Lower level",
    ...overrides,
  }
}

describe("parseBuildertrendCostCode", () => {
  it("reads plain and sub-code (\"... \") cost codes", () => {
    expect(parseBuildertrendCostCode("01 71 13 - Mobilization")).toEqual({ code: "01 71 13", name: "Mobilization" })
    expect(parseBuildertrendCostCode("... 03 11 13 - Forming Boards")).toEqual({ code: "03 11 13", name: "Forming Boards" })
    expect(parseBuildertrendCostCode("Mobilization")).toBeNull()
  })
})

describe("parseBuildertrendEstimateRows", () => {
  it("keeps exported amounts exactly and turns parent groups into ordered phases", () => {
    const result = parseBuildertrendEstimateRows([
      row(),
      row({ "Parent Group": "Piers", "Parent Group Description": "Concrete piers", "Builder Cost": 100, "Total Price": 126, Markup: 26 }),
      row({ Title: "Bracing rental", "Builder Cost": 50, "Total Price": 50, Markup: 0 }),
    ])
    if (!result.success) throw new Error(result.error)
    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toMatchObject({ costCode: "03 21 00", directCostCents: 23_530, lineTotalCents: 29_648, markupRateBasisPoints: 2_600, notes: "Lower level", phaseName: "Footings" })
    expect(result.phases).toEqual([
      { name: "Footings", description: "Labor and materials for footings", sortOrder: 1, fromParentGroup: true },
      { name: "Piers", description: "Concrete piers", sortOrder: 2, fromParentGroup: true },
    ])
    expect(result.totalCents).toBe(29_648 + 12_600 + 5_000)
    expect(result.directCostCents).toBe(23_530 + 10_000 + 5_000)
  })

  it("rejects files that aren't Buildertrend estimate exports", () => {
    const result = parseBuildertrendEstimateRows([{ Name: "x", Amount: 1 }])
    expect(result.success).toBe(false)
  })

  it("refuses options and taxed rows rather than changing the total", () => {
    expect(parseBuildertrendEstimateRows([row({ "Option Type": "Optional" })]).success).toBe(false)
    expect(parseBuildertrendEstimateRows([row({ "Tax Amount": 12.5 })]).success).toBe(false)
  })

  it("skips blank padding rows and rejects a price below cost", () => {
    const blank = Object.fromEntries(Object.keys(row()).map((key) => [key, ""]))
    const padded = parseBuildertrendEstimateRows([row(), blank])
    expect(padded.success && padded.lines.length).toBe(1)
    expect(parseBuildertrendEstimateRows([row({ "Total Price": 100 })]).success).toBe(false)
  })
})
