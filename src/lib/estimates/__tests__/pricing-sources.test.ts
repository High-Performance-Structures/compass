import { describe, expect, it } from "vitest"

import { FEATURE_SETTINGS, parseFeatureSettings } from "@/lib/feature-settings/registry"
import {
  DEFAULT_PRICING_SOURCES,
  estimatePricingSettingsSchema,
  findPricingSource,
  pricingSourceChoices,
  pricingSourceOutcome,
  takeoffTodoTitle,
  unpricedLinesMessage,
} from "@/lib/estimates/pricing-sources"

describe("estimate pricing sources", () => {
  it("defaults cover suppliers, subs, our own takeoffs, equipment and owner scope", () => {
    expect(DEFAULT_PRICING_SOURCES.map((source) => source.id)).toEqual([
      "supplier",
      "subcontractor",
      "internal-labor",
      "internal-material",
      "equipment",
      "owner",
    ])
    expect(findPricingSource(DEFAULT_PRICING_SOURCES, "owner")).toMatchObject({ action: "owner_pricing", ownerScope: true })
    expect(findPricingSource(DEFAULT_PRICING_SOURCES, "internal-material")).toMatchObject({ action: "takeoff", sageCostType: "material" })
    expect(findPricingSource(DEFAULT_PRICING_SOURCES, "equipment")).toMatchObject({ action: "takeoff", sageCostType: "equipment" })
    expect(estimatePricingSettingsSchema.safeParse(FEATURE_SETTINGS["estimate-pricing"].defaults).success).toBe(true)
  })

  it("falls back to the defaults when nothing is saved", () => {
    expect(parseFeatureSettings("estimate-pricing", null).sources).toHaveLength(DEFAULT_PRICING_SOURCES.length)
  })

  it("rejects duplicate ids", () => {
    const supplier = DEFAULT_PRICING_SOURCES[0]
    expect(estimatePricingSettingsSchema.safeParse({ sources: [supplier, supplier] }).success).toBe(false)
  })

  it("keeps a turned-off choice offered only on lines that already use it", () => {
    const sources = DEFAULT_PRICING_SOURCES.map((source) => (source.id === "equipment" ? { ...source, active: false } : source))
    expect(pricingSourceChoices(sources, null).some((source) => source.id === "equipment")).toBe(false)
    expect(pricingSourceChoices(sources, "equipment").some((source) => source.id === "equipment")).toBe(true)
  })

  it("explains the outcome with the Sage cost type", () => {
    const sub = findPricingSource(DEFAULT_PRICING_SOURCES, "subcontractor")
    expect(sub && pricingSourceOutcome(sub)).toBe("Waiting on a quote. Sage cost type: Subcontract.")
  })

  it("names the takeoff to-do by cost code and estimate", () => {
    expect(takeoffTodoTitle({ costCode: "3.200", costCodeName: "ICF block", estimateNumber: "N-1003-01" })).toBe(
      "Takeoff and price 3.200 ICF block (estimate N-1003-01)",
    )
  })

  it("blocks signature while lines are waiting on a price", () => {
    expect(unpricedLinesMessage([{ costCode: "1", lineTotalCents: 100 }])).toBeNull()
    expect(unpricedLinesMessage([{ costCode: "16.100", lineTotalCents: 0 }, { costCode: "1", lineTotalCents: 5 }])).toBe(
      "Price every line before signature. Still waiting: 16.100.",
    )
  })
})
