import { describe, expect, it } from "vitest"

import {
  approvedRfqResponseSnapshot,
  currencyAmountToCents,
  parseApprovedRfqResponseSnapshot,
  rfqResponseCoversScope,
} from "@/lib/rfqs/bid-workflow"

describe("RFQ bid workflow", () => {
  it("converts submitted currency to integer cents", () => {
    expect(currencyAmountToCents(123.456)).toBe(12_346)
    expect(currencyAmountToCents(-1)).toBe(0)
  })

  it("reads the exact approved response snapshot", () => {
    const response = parseApprovedRfqResponseSnapshot(
      approvedRfqResponseSnapshot({
        decision: "quote",
        amount: 1_250,
        lines: [
          { lineNumber: 1, amount: 1_000, notes: "Base" },
          { lineNumber: 2, amount: 250, notes: null },
        ],
        leadTime: "Two weeks",
        validUntil: "2026-09-30",
        notes: null,
        responderUserId: "vendor-user",
        responderName: "Vendor Estimator",
        responderCompany: "Vendor Company",
        submittedAt: "2026-09-02T12:00:00.000Z",
      })
    )
    expect(response?.totalCents).toBe(125_000)
    expect(response?.lines[0]?.amountCents).toBe(100_000)
    expect(response?.lines).toHaveLength(2)
  })

  it("requires every scoped RFQ line before approval or import", () => {
    expect(rfqResponseCoversScope([], [])).toBe(true)
    expect(
      rfqResponseCoversScope([1, 2], [{ lineNumber: 1 }, { lineNumber: 2 }])
    ).toBe(true)
    expect(rfqResponseCoversScope([1, 2], [])).toBe(false)
    expect(
      rfqResponseCoversScope([1, 2], [{ lineNumber: 1 }, { lineNumber: 1 }])
    ).toBe(false)
  })
})
