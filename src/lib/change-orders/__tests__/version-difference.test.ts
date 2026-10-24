import { describe, expect, it } from "vitest"

import { estimateVersionDifference } from "@/lib/change-orders/version-difference"

function line(costCode: string, lineTotalCents: number, description = `Line ${costCode}`) {
  return {
    id: crypto.randomUUID(),
    divisionCode: costCode.slice(0, 2),
    divisionName: "Division",
    costCode,
    description,
    directCostCents: lineTotalCents,
    markupCents: 0,
    taxCents: 0,
    lineTotalCents,
    ownerVisible: true,
    includeInBuilderFee: true,
    sortOrder: 1,
  }
}

describe("estimateVersionDifference", () => {
  it("lists added, removed and changed lines and leaves unchanged lines out", () => {
    const difference = estimateVersionDifference(
      [line("01 10 00", 50_000, "Permits"), line("02 41 00", 80_000, "Demolition"), line("06 10 00", 300_000, "Framing")],
      [line("01 10 00", 50_000, "Permits"), line("06 10 00", 340_000, "Framing"), line("07 21 00", 25_000, "Insulation")]
    )
    expect(difference.lines).toEqual([
      expect.objectContaining({ lineNumber: 1, kind: "removed", costCode: "02 41 00", previousAmountCents: 80_000, newAmountCents: 0, amountCents: -80_000 }),
      expect.objectContaining({ lineNumber: 2, kind: "changed", costCode: "06 10 00", previousAmountCents: 300_000, newAmountCents: 340_000, amountCents: 40_000 }),
      expect.objectContaining({ lineNumber: 3, kind: "added", costCode: "07 21 00", previousAmountCents: 0, newAmountCents: 25_000, amountCents: 25_000 }),
    ])
    expect(difference.netChangeCents).toBe(-15_000)
    expect(difference.lines.reduce((sum, item) => sum + item.amountCents, 0)).toBe(difference.netChangeCents)
  })

  it("matches lines in one cost code by description, then pairs reworded leftovers", () => {
    const difference = estimateVersionDifference(
      [line("09 91 00", 10_000, "Interior paint"), line("09 91 00", 4_000, "Exterior trim paint")],
      [line("09 91 00", 4_000, "Exterior trim paint"), line("09 91 00", 12_000, "Interior paint & stain")]
    )
    expect(difference.lines).toEqual([
      expect.objectContaining({
        kind: "changed",
        description: "Interior paint & stain (was: Interior paint)",
        previousAmountCents: 10_000,
        newAmountCents: 12_000,
        amountCents: 2_000,
      }),
    ])
  })

  it("is empty when the versions price the same", () => {
    const lines = [line("03 30 00", 120_000, "Concrete")]
    expect(estimateVersionDifference(lines, lines).lines).toEqual([])
  })
})
