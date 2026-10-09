import { describe, expect, it } from "vitest"
import { costItemFillFromEntry, entryChanged, rateBookEntryInputSchema, type RateBookEntryInput } from "@/lib/rate-book/model"

const base: RateBookEntryInput = {
  name: "Komatsu PC88 with operator",
  category: "machine",
  unit: "hr",
  unitCostCents: 16500,
  markupBasisPoints: 1500,
  divisionCode: "31",
  divisionName: "Earthwork",
  costCode: "31 23 16",
  costCodeName: "Excavation",
  fuelType: "diesel",
  fuelGallonsPerUnit: 3.5,
  notes: null,
}

describe("rate book input", () => {
  it("clears fuel use when the rate has no fuel and blanks to null", () => {
    const parsed = rateBookEntryInputSchema.parse({ ...base, fuelType: "none", notes: "  " })
    expect(parsed.fuelGallonsPerUnit).toBeNull()
    expect(parsed.notes).toBeNull()
  })

  it("requires a name and unit", () => {
    expect(rateBookEntryInputSchema.safeParse({ ...base, name: " " }).success).toBe(false)
    expect(rateBookEntryInputSchema.safeParse({ ...base, unit: "" }).success).toBe(false)
  })

  it("detects real changes only", () => {
    expect(entryChanged(base, { ...base })).toBe(false)
    expect(entryChanged(base, { ...base, unitCostCents: 17000 })).toBe(true)
  })

  it("fills an estimate cost item and remembers the version", () => {
    const fill = costItemFillFromEntry({ ...base, id: "rate-1", version: 3 })
    expect(fill).toMatchObject({ description: base.name, unit: "hr", unitCostCents: 16500, markupRateBasisPoints: 1500, costCode: "31 23 16", rateBookEntryId: "rate-1", rateBookVersion: 3 })
  })
})
