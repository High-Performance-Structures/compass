import { describe, expect, it } from "vitest"

import { withSelectionDefaults } from "@/lib/domain/selections/choice-rules"
import { FEATURE_SETTINGS, parseFeatureSettings } from "@/lib/feature-settings/registry"
import { categoryLeadTimeDays, newRoundId, ownerPriceFromMarkup } from "@/lib/feature-settings/selection-settings"
import { parseChoiceTemplateCsv, parseCsvRows } from "@/lib/selections/choice-template-csv"
import { roundDueDate, roundProgress } from "@/lib/selections/rounds"

describe("selection settings", () => {
  it("has defaults any company can start from", () => {
    const settings = parseFeatureSettings("selections", null)
    expect(settings).toEqual(FEATURE_SETTINGS.selections.defaults)
    expect(settings.rounds.map((round) => round.name)).toEqual(["Rough-in", "Finishes"])
    expect(settings.ownerMarkupPercent).toBeNull()
  })

  it("prefills owner price from the markup and lead time from the category, never over what staff typed", () => {
    const base = { title: "Oak", description: null, priceCents: 100000, ownerPriceCents: null, leadTimeDays: null, vendorId: null, supplierName: null, status: "proposed" as const }
    expect(withSelectionDefaults(base, { ownerMarkupPercent: 15, categoryLeadTimeDays: 21, isNew: true })).toMatchObject({ ownerPriceCents: 115000, leadTimeDays: 21 })
    expect(withSelectionDefaults({ ...base, ownerPriceCents: 99000, leadTimeDays: 5 }, { ownerMarkupPercent: 15, categoryLeadTimeDays: 21, isNew: true })).toMatchObject({ ownerPriceCents: 99000, leadTimeDays: 5 })
    expect(withSelectionDefaults(base, { ownerMarkupPercent: null, categoryLeadTimeDays: 21, isNew: false })).toMatchObject({ ownerPriceCents: null, leadTimeDays: null })
    expect(ownerPriceFromMarkup(null, 10)).toBeNull()
    expect(categoryLeadTimeDays({ leadTimeDays: { Tile: 21 } }, " tile ")).toBe(21)
    expect(categoryLeadTimeDays({ leadTimeDays: { Tile: 21 } }, "Plumbing")).toBeNull()
    expect(newRoundId("Rough-in", ["rough-in"])).toBe("rough-in-2")
  })
})

describe("rounds", () => {
  const schedule = [
    { title: "Drywall hang", startDate: "2027-02-26" },
    { title: "Drywall finish", startDate: "2027-03-05" },
    { title: "Framing inspection", startDate: "2026-12-25" },
  ]

  it("dates a round from the first matching schedule item, less the buffer", () => {
    expect(roundDueDate({ scheduleItem: "drywall", bufferDays: 14 }, schedule)).toBe("2027-02-12")
    expect(roundDueDate({ scheduleItem: "Framing inspection", bufferDays: 21 }, schedule)).toBe("2026-12-04")
    expect(roundDueDate({ scheduleItem: "Roofing", bufferDays: 21 }, schedule)).toBeNull()
    expect(roundDueDate({ scheduleItem: " ", bufferDays: 21 }, schedule)).toBeNull()
  })

  it("is ready when every selection in it has a pick", () => {
    const selections = [
      { roundKey: "r1", hasPick: true, deltaCents: 98500 },
      { roundKey: "r1", hasPick: true, deltaCents: -12000 },
      { roundKey: "r1", hasPick: false, deltaCents: null },
      { roundKey: "r2", hasPick: true, deltaCents: 5 },
    ]
    expect(roundProgress("r1", selections)).toEqual({ total: 3, chosen: 2, deltaCents: 86500, ready: false })
    expect(roundProgress("r2", selections)).toEqual({ total: 1, chosen: 1, deltaCents: 5, ready: true })
    expect(roundProgress("empty", selections).ready).toBe(false)
  })
})

describe("choice template CSV", () => {
  it("reads quoted fields and groups rows by template", () => {
    const csv = [
      "Template,Category,Title,Description,Supplier,Supplier price,Owner price,Lead time days,Product URL",
      'Kitchen tile,Tile,"Zellige 3x3, white","Hand made, ""glossy""",Tile Supply,"$2,650.00",3100,14,https://tile.example.com/z',
      "Kitchen tile,Tile,Subway 3x12,,,3200,,21,",
      "Vanity,Cabinets,Oak 36,,,,,,",
      ",Tile,No template,,,,,,",
      "Vanity,,Bad price,,,abc,,,",
    ].join("\r\n")
    const result = parseChoiceTemplateCsv(csv)
    expect(result.errors).toEqual(["Row 5: needs a template name and a title.", "Row 6: prices must be dollar amounts."])
    expect(result.templates.map((template) => [template.name, template.category, template.items.length])).toEqual([
      ["Kitchen tile", "Tile", 2],
      ["Vanity", "Cabinets", 1],
    ])
    expect(result.templates[0]?.items[0]).toEqual({
      title: "Zellige 3x3, white",
      description: 'Hand made, "glossy"',
      supplierName: "Tile Supply",
      priceCents: 265000,
      ownerPriceCents: 310000,
      leadTimeDays: 14,
      productUrl: "https://tile.example.com/z",
    })
  })

  it("needs the Template and Title columns", () => {
    expect(parseChoiceTemplateCsv("Name,Price\nA,1").errors).toEqual(["The first row needs Template and Title columns."])
    expect(parseChoiceTemplateCsv("").errors).toEqual(["The file is empty."])
    expect(parseCsvRows('a,"b\nc"\n\n')).toEqual([["a", "b\nc"]])
  })
})
