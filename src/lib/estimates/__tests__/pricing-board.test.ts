import { describe, expect, it } from "vitest"

import { buildPricingBoard, defaultPackageTitle, packageSelectionProblem, pricingBoardRfqStatus } from "@/lib/estimates/pricing-board"
import { DEFAULT_PRICING_SOURCES } from "@/lib/estimates/pricing-sources"

function line(id: string, costCode: string, pricingSource: string | null, lineTotalCents = 0) {
  return { id, costCode, costCodeName: `Code ${costCode}`, description: `Code ${costCode}`, divisionCode: costCode.split(".")[0] ?? "", lineTotalCents, pricingSource, todo: null }
}

function rfq(id: string, codes: readonly string[], extra: Record<string, unknown> = {}, status = "draft") {
  return {
    id,
    number: `RFQ-${id}`,
    title: `RFQ ${id}`,
    status,
    companyName: `Vendor ${id}`,
    payloadJson: JSON.stringify({ scopeItems: codes.map((costCode, index) => ({ lineNumber: index + 1, description: costCode, costCode })), ...extra }),
    hasManualResponse: false,
  }
}

const quote = { decision: "quote", amount: 100, lines: [], responderUserId: "u", responderName: "V", submittedAt: "2026-10-27" }

describe("pricing board", () => {
  it("lists only lines with a Priced by choice and counts their RFQs and quotes by cost code", () => {
    const board = buildPricingBoard({
      sources: DEFAULT_PRICING_SOURCES,
      lines: [line("a", "16.100", "subcontractor"), line("b", "16.400", "subcontractor"), line("c", "3.100", null)],
      rfqs: [
        rfq("1", ["16.100", "16.400"], { bidPackageId: "p1", estimatePackage: { id: "p1", title: "Electrical" }, vendorResponse: quote }, "response_received"),
        rfq("2", ["16.100", "16.400"], { bidPackageId: "p1", estimatePackage: { id: "p1", title: "Electrical" } }, "sent"),
        rfq("3", ["9.000"]),
      ],
    })
    expect(board.lines.map((item) => item.id)).toEqual(["a", "b"])
    expect(board.lines[0]).toMatchObject({ rfqCount: 2, quoteCount: 1 })
    expect(board.packages).toHaveLength(1)
    expect(board.packages[0]).toMatchObject({ id: "p1", title: "Electrical", costCodes: ["16.100", "16.400"] })
  })

  it("groups a duplicated RFQ with the RFQ it was copied from", () => {
    const board = buildPricingBoard({
      sources: DEFAULT_PRICING_SOURCES,
      lines: [line("a", "15.100", "subcontractor")],
      rfqs: [rfq("src", ["15.100"]), rfq("dup", ["15.100"], { bidPackageId: "src" })],
    })
    expect(board.packages).toHaveLength(1)
    expect(board.packages[0]?.rfqs.map((item) => item.id)).toEqual(["src", "dup"])
  })

  it("doesn't count closed RFQs toward a line", () => {
    const board = buildPricingBoard({ sources: DEFAULT_PRICING_SOURCES, lines: [line("a", "6.110", "supplier")], rfqs: [rfq("1", ["6.110"], {}, "void")] })
    expect(board.lines[0]?.rfqCount).toBe(0)
  })

  it("reads RFQ status from the vendor's answer", () => {
    expect(pricingBoardRfqStatus({ status: "sent", payloadJson: null, hasManualResponse: false })).toBe("sent")
    expect(pricingBoardRfqStatus({ status: "sent", payloadJson: null, hasManualResponse: true })).toBe("quoted")
    expect(pricingBoardRfqStatus({ status: "sent", payloadJson: JSON.stringify({ vendorResponse: { ...quote, decision: "decline" } }), hasManualResponse: false })).toBe("declined")
    expect(pricingBoardRfqStatus({ status: "draft", payloadJson: null, hasManualResponse: false })).toBe("draft")
  })

  it("only packages quote lines with the same Priced by choice", () => {
    const board = buildPricingBoard({
      sources: DEFAULT_PRICING_SOURCES,
      lines: [line("a", "16.100", "subcontractor"), line("b", "6.110", "supplier"), line("c", "6.100", "internal-labor")],
      rfqs: [],
    })
    const [sub, supplier, labor] = board.lines
    expect(packageSelectionProblem([])).toBe("Choose at least one cost code.")
    expect(sub && packageSelectionProblem([sub])).toBeNull()
    expect(sub && supplier && packageSelectionProblem([sub, supplier])).toContain("same")
    expect(labor && packageSelectionProblem([labor])).toContain("supplier or subcontractor")
  })

  it("names a package from its cost codes", () => {
    expect(defaultPackageTitle([{ costCode: "16.100", costCodeName: "Electrical" }, { costCode: "16.400", costCodeName: "Low voltage" }])).toBe("16.100 Electrical + 16.400 Low voltage")
  })
})
