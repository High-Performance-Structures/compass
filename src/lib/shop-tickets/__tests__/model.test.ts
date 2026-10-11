import { describe, expect, it } from "vitest"
import {
  budgetCostCodeSet,
  formatTicketNumber,
  isOutsideBudget,
  lineAmountCents,
  nextSequenceNumber,
  payApplicationFolderName,
  payApplicationLabel,
  priceShopTicketLines,
  type ShopTicketRates,
} from "@/lib/shop-tickets/model"

const RATES: ShopTicketRates = {
  labor: { rateBookEntryId: "rb-labor", name: "Labor", rateCents: 5500 },
  machine: { rateBookEntryId: "rb-machine", name: "Machine", rateCents: 12000 },
}

describe("shop ticket pricing", () => {
  it("bills hours at the set rate", () => {
    expect(lineAmountCents(114.98, 5500)).toBe(632390)
    expect(lineAmountCents(23.37, 5500)).toBe(128535)
  })

  it("prices lines and totals them", () => {
    const result = priceShopTicketLines(
      [
        { costCode: "09 91 23", description: "Interior Painting", rateKind: "labor", hours: 114.98 },
        { costCode: "31 22 13", description: "Rough Grading", rateKind: "machine", hours: 2 },
      ],
      RATES,
      budgetCostCodeSet(["09 91 23", "01 71 13"]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalCents).toBe(632390 + 24000)
    expect(result.lines.map((line) => line.outsideBudget)).toEqual([false, true])
    expect(result.lines[1]?.rateBookEntryId).toBe("rb-machine")
  })

  it("asks for a rate when the rate book has none", () => {
    const result = priceShopTicketLines(
      [{ costCode: "31 22 13", description: "Rough Grading", rateKind: "machine", hours: 1 }],
      { ...RATES, machine: null },
      null,
    )
    expect(result).toEqual({ ok: false, error: "There is no machine rate yet. Add one in Settings → Rate book." })
  })

  it("rejects missing cost codes and zero hours", () => {
    expect(priceShopTicketLines([{ costCode: " ", description: "", rateKind: "labor", hours: 1 }], RATES, null).ok).toBe(false)
    expect(priceShopTicketLines([{ costCode: "01 71 13", description: "", rateKind: "labor", hours: 0 }], RATES, null).ok).toBe(false)
  })
})

describe("budget check", () => {
  it("skips projects without a budget", () => {
    expect(isOutsideBudget("31 22 13", null)).toBe(false)
  })

  it("matches codes however they are spaced", () => {
    const budget = budgetCostCodeSet(["01 71 13", "31 23 16.13"])
    expect(isOutsideBudget("017113", budget)).toBe(false)
    expect(isOutsideBudget("31 23 16.13", budget)).toBe(false)
    expect(isOutsideBudget("31 22 13", budget)).toBe(true)
  })
})

describe("numbering and draw folders", () => {
  it("continues from the highest number and respects the starting number", () => {
    expect(nextSequenceNumber(null, 176)).toBe(176)
    expect(nextSequenceNumber(180, 176)).toBe(181)
    expect(formatTicketNumber("GSL", 176)).toBe("GSL-176")
  })

  it("names the draw folder from the template pattern", () => {
    expect(payApplicationFolderName(7, "2026-09-01")).toBe("PayApplication-07-September-2026")
    expect(payApplicationFolderName(null, "2026-09-01")).toBeNull()
    expect(payApplicationLabel(7, "2026-09-01")).toBe("Pay app 7 · September 2026")
  })
})
