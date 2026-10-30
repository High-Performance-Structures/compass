import { describe, expect, it } from "vitest"

import { orderedCents, remainingTradeCodes } from "@/lib/trade-letters/orders"

const codes = [
  { costCode: "03-300", description: "ICF block", amountCents: 1_000_00 },
  { costCode: "03-310", description: "Bracing", amountCents: 200_00 },
]

describe("supplier POs against an accepted quote", () => {
  it("leaves the whole quote when nothing is ordered", () => {
    expect(remainingTradeCodes(codes, [])).toEqual(codes)
    expect(orderedCents([])).toBe(0)
  })

  it("takes each PO line off its own cost code", () => {
    const orders = [{ status: "sent", lines: [{ costCode: "03-300", amountCents: 400_00 }] }]
    expect(orderedCents(orders)).toBe(400_00)
    expect(remainingTradeCodes(codes, orders)).toEqual([
      { costCode: "03-300", description: "ICF block", amountCents: 600_00 },
      { costCode: "03-310", description: "Bracing", amountCents: 200_00 },
    ])
  })

  it("drops fully ordered codes and never goes below zero", () => {
    const orders = [{ status: "draft", lines: [{ costCode: "03-310", amountCents: 250_00 }] }]
    expect(remainingTradeCodes(codes, orders)).toEqual([codes[0]])
  })

  it("ignores void POs and lines on other codes", () => {
    const orders = [
      { status: "void", lines: [{ costCode: "03-300", amountCents: 1_000_00 }] },
      { status: "draft", lines: [{ costCode: "01-500", amountCents: 75_00 }] },
    ]
    expect(orderedCents(orders)).toBe(75_00)
    expect(remainingTradeCodes(codes, orders)).toEqual(codes)
  })
})
