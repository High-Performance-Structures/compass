import { describe, expect, it } from "vitest"

import { lineChangeOrdersByRow } from "../pay-application-change-orders"
import { lineChangeOrderKey, lineChangeOrderLabel, overBilledAmount, overBilledLines } from "../pay-application-line-checks"

const money = (value: number): string => `$${value.toFixed(2)}`

describe("overBilledAmount", () => {
  it("flags a row billed past its scheduled value", () => {
    expect(overBilledAmount({ adjustedEstimate: 8_000, totalCompletedStored: 10_000 })).toBe(2_000)
  })

  it("never flags a fully or partly billed row, rounding included", () => {
    expect(overBilledAmount({ adjustedEstimate: 100.1, totalCompletedStored: 100.10000000001 })).toBe(0)
    expect(overBilledAmount({ adjustedEstimate: 5_000, totalCompletedStored: 2_500 })).toBe(0)
  })

  it("lists only the over-billed rows", () => {
    const rows = [
      { costCode: "01 00 00", adjustedEstimate: 100, totalCompletedStored: 100 },
      { costCode: "02 00 00", adjustedEstimate: 100, totalCompletedStored: 130 },
    ]
    expect(overBilledLines(rows).map((row) => row.costCode)).toEqual(["02 00 00"])
  })
})

describe("lineChangeOrdersByRow", () => {
  const base = { number: "CO-002", title: "Extra pump", recordType: "change_order" }

  it("labels the assembly row a change order changed, summing its parts", () => {
    const byRow = lineChangeOrdersByRow([
      { ...base, changeOrderId: "co-2", costCode: "31 00 00", contractAssemblyId: "a1", amountCents: 200_000 },
      { ...base, changeOrderId: "co-2", costCode: "31 00 00", contractAssemblyId: "a1", amountCents: 25_000 },
    ])
    expect(byRow[lineChangeOrderKey("31 00 00", "asm:a1")]).toEqual([
      { number: "CO-002", title: "Extra pump", recordType: "change_order", amount: 2_250 },
    ])
  })

  it("skips separate work, which has its own named row", () => {
    expect(
      lineChangeOrdersByRow([{ ...base, changeOrderId: "co-1", costCode: "07 00 00", contractAssemblyId: null, amountCents: 170_000 }])
    ).toEqual({})
  })
})

describe("lineChangeOrderLabel", () => {
  it("shows credits with a minus sign and charges with a plus sign", () => {
    expect(lineChangeOrderLabel({ number: "CO-003", title: "Credit", recordType: "change_order", amount: -1_234.5 }, money)).toBe(
      "CO-003 · Credit −$1234.50"
    )
    expect(lineChangeOrderLabel({ number: "", title: "", recordType: "variance", amount: 50 }, money)).toBe("Variance +$50.00")
  })
})
