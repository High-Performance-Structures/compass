import { describe, expect, it } from "vitest"

import { DEFAULT_TRADE_DOC_TYPES, driveFolderIdFromInput } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs, tradeDocCountLabel, type TradeDocOnFile } from "@/lib/trade-docs/status"

function doc(docType: string, overrides: Partial<TradeDocOnFile> = {}): TradeDocOnFile {
  return {
    id: `${docType}-1`,
    docType,
    kind: "document",
    fileName: `${docType}.pdf`,
    webUrl: null,
    effectiveOn: null,
    expiresOn: null,
    checks: [],
    notes: null,
    source: "upload",
    createdAt: "2026-10-01T12:00:00.000Z",
    createdByName: "Office",
    ...overrides,
  }
}

describe("summarizeTradeDocs", () => {
  it("lists every required document for a subcontractor and counts what is owed", () => {
    const summary = summarizeTradeDocs({
      docTypes: DEFAULT_TRADE_DOC_TYPES,
      vendorCategory: "Subcontractor",
      docs: [
        doc("w9"),
        doc("gl-certificate", { expiresOn: "2026-09-30" }),
        doc("business-license", { expiresOn: "2026-11-15" }),
        doc("trade-agreement"),
      ],
      today: "2026-10-28",
    })
    expect(summary.requiredCount).toBe(6)
    expect(summary.lines.map((line) => [line.type.id, line.state])).toEqual([
      ["w9", "on_file"],
      ["gl-certificate", "expired"],
      ["wc-certificate", "missing"],
      ["business-license", "expiring"],
      ["trade-agreement", "on_file"],
      ["info-sheet", "missing"],
    ])
    expect(summary.owed.map((line) => line.type.id)).toEqual(["gl-certificate", "wc-certificate", "info-sheet"])
    expect(summary.complete).toBe(false)
    expect(tradeDocCountLabel(summary)).toBe("3 of 6 on file")
  })

  it("needs only a W-9 from a supplier, matching the category without case", () => {
    const summary = summarizeTradeDocs({ docTypes: DEFAULT_TRADE_DOC_TYPES, vendorCategory: "supplier", docs: [doc("w9")], today: "2026-10-28" })
    expect(summary.lines.map((line) => line.type.id)).toEqual(["w9"])
    expect(summary.complete).toBe(true)
  })

  it("accepts the alternative and uses the newest document of a type", () => {
    const summary = summarizeTradeDocs({
      docTypes: DEFAULT_TRADE_DOC_TYPES,
      vendorCategory: "Subcontractor",
      docs: [
        doc("wc-certificate", { id: "old", expiresOn: "2025-01-01", createdAt: "2025-01-01T00:00:00.000Z" }),
        doc("wc-certificate", { id: "new", kind: "waiver", createdAt: "2026-10-20T00:00:00.000Z" }),
        doc("gl-certificate"),
      ],
      today: "2026-10-28",
    })
    const wc = summary.lines.find((line) => line.type.id === "wc-certificate")
    expect(wc?.state).toBe("waived")
    expect(wc?.doc?.id).toBe("new")
    // An expiring type with no date on file asks for one but isn't owed.
    expect(summary.lines.find((line) => line.type.id === "gl-certificate")?.state).toBe("needs_date")
  })

  it("shows documents on file for vendors that need nothing", () => {
    const summary = summarizeTradeDocs({ docTypes: DEFAULT_TRADE_DOC_TYPES, vendorCategory: "Consultant", docs: [doc("w9")], today: "2026-10-28" })
    expect(summary.requiredCount).toBe(0)
    expect(summary.lines).toHaveLength(1)
    expect(tradeDocCountLabel(summary)).toBe("Not required")
  })
})

describe("driveFolderIdFromInput", () => {
  it("reads folder links and bare ids", () => {
    expect(driveFolderIdFromInput("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp")
    expect(driveFolderIdFromInput("1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp")
    expect(driveFolderIdFromInput("  ")).toBeNull()
    expect(driveFolderIdFromInput("not a folder")).toBeNull()
  })
})
