import { describe, expect, it } from "vitest"

import { planBidFill } from "@/lib/estimates/bid-fill"

const target = (id: string, costCode: string, extra: Partial<{ lineTotalCents: number; pricingSource: string | null; sortOrder: number; hasCostItems: boolean }> = {}) => ({
  id,
  costCode,
  lineTotalCents: 0,
  pricingSource: "subcontractor",
  sortOrder: 1,
  hasCostItems: false,
  ...extra,
})

describe("planBidFill", () => {
  it("fills each waiting line for the bid's cost codes and adds the rest", () => {
    const plan = planBidFill(
      [{ costCode: "16.100" }, { costCode: "16.400" }, { costCode: "9.000" }],
      [target("a", "16.100"), target("b", "16.400")],
    )
    expect(plan.map((item) => (item.kind === "fill" ? item.targetLineId : "add"))).toEqual(["a", "b", "add"])
  })

  it("never overwrites a priced line or one built from a cost breakdown", () => {
    const plan = planBidFill(
      [{ costCode: "3.100" }, { costCode: "6.110" }],
      [target("priced", "3.100", { lineTotalCents: 5000 }), target("breakdown", "6.110", { hasCostItems: true })],
    )
    expect(plan.every((item) => item.kind === "add")).toBe(true)
  })

  it("uses each waiting line once and prefers lines with a Priced by choice", () => {
    const plan = planBidFill(
      [{ costCode: "15.100" }, { costCode: "15.100" }],
      [target("plain", "15.100", { pricingSource: null, sortOrder: 1 }), target("chosen", "15.100", { sortOrder: 5 })],
    )
    expect(plan.map((item) => (item.kind === "fill" ? item.targetLineId : "add"))).toEqual(["chosen", "plain"])
  })

  it("adds a line when the bid line has no cost code", () => {
    expect(planBidFill([{ costCode: null }], [target("a", "16.100")])[0]?.kind).toBe("add")
  })
})
