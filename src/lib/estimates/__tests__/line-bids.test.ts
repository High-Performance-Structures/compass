import { describe, expect, it } from "vitest"

import { acceptableLines, bidsForCostCode } from "@/lib/estimates/line-bids"

function rfq(id: string, scope: readonly [number, string][], response: Record<string, unknown> | null, extra: Partial<{ approvalId: string | null; importedLineNumbers: number[] }> = {}) {
  return {
    id,
    number: `RFQ-${id}`,
    title: "Electrical",
    status: response ? "response_received" : "sent",
    companyName: `Vendor ${id}`,
    payloadJson: JSON.stringify({
      scopeItems: scope.map(([lineNumber, costCode]) => ({ lineNumber, description: `Line ${costCode}`, costCode })),
      vendorResponse: response,
    }),
    approvalId: extra.approvalId ?? null,
    importedLineNumbers: extra.importedLineNumbers ?? [],
  }
}

const quote = (amount: number, lines: readonly [number, number][]) => ({
  decision: "quote",
  amount,
  lines: lines.map(([lineNumber, value]) => ({ lineNumber, amount: value, notes: null })),
  leadTime: "3 weeks",
  validUntil: "2026-12-31",
  notes: null,
  responderUserId: "quote-link:x",
  responderName: "Pat",
  responderCompany: null,
  submittedAt: "2026-10-27T00:00:00Z",
})

describe("bidsForCostCode", () => {
  const package2: readonly [number, string][] = [[1, "16.100"], [2, "16.400"]]

  it("prices the code from each vendor's line and sorts cheapest first", () => {
    const bids = bidsForCostCode("16.100", [
      rfq("a", package2, quote(46900, [[1, 41250], [2, 5650]])),
      rfq("b", [[1, "16.100"]], quote(38400, [[1, 38400]])),
      rfq("c", [[1, "16.100"]], null),
      rfq("d", [[1, "9.000"]], quote(100, [[1, 100]])),
    ])
    expect(bids.map((bid) => [bid.rfqId, bid.priceCents])).toEqual([["b", 3_840_000], ["a", 4_125_000]])
    expect(bids[1]).toMatchObject({ totalCents: 4_690_000, state: "quoted", vendor: "Vendor a" })
  })

  it("offers every not-yet-imported priced line of the bid for accepting", () => {
    const [bid] = bidsForCostCode("16.100", [rfq("a", package2, quote(46900, [[1, 41250], [2, 5650]]), { approvalId: "ap", importedLineNumbers: [] })])
    expect(bid && acceptableLines(bid).map((line) => line.costCode)).toEqual(["16.100", "16.400"])
    expect(bid?.state).toBe("approved")
  })

  it("marks a bid already in the estimate for this code", () => {
    const [bid] = bidsForCostCode("16.100", [rfq("a", package2, quote(46900, [[1, 41250], [2, 5650]]), { approvalId: "ap", importedLineNumbers: [1] })])
    expect(bid?.state).toBe("accepted")
    expect(bid && acceptableLines(bid).map((line) => line.costCode)).toEqual(["16.400"])
  })

  it("uses the total for a single-line request answered without line prices, and lists declines last", () => {
    const bids = bidsForCostCode("15.100", [
      rfq("x", [[1, "15.100"]], { ...quote(0, []), decision: "decline", amount: null }),
      rfq("y", [[1, "15.100"]], quote(32750, [])),
    ])
    expect(bids.map((bid) => [bid.rfqId, bid.state, bid.priceCents])).toEqual([["y", "quoted", 3_275_000], ["x", "declined", null]])
  })
})
