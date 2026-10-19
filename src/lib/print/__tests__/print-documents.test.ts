import { describe, expect, it } from "vitest"

import { isPrintDocument, printPdfHref, printPreviewHref, printSourcePath } from "../print-documents"

describe("print documents", () => {
  it("links a document's preview and PDF with only its own parameters", () => {
    const link = {
      projectId: "H 1",
      document: "change-order",
      params: { changeOrderId: "co-1", other: "ignored" },
      number: "H-1-CO-001",
    } as const
    expect(printPreviewHref(link)).toBe("/print/projects/H%201/change-order?changeOrderId=co-1&number=H-1-CO-001")
    expect(printPdfHref(link)).toBe("/api/projects/H%201/print/change-order?changeOrderId=co-1&number=H-1-CO-001")
  })

  it("renders page documents directly and print-only documents from their source page", () => {
    expect(printSourcePath("p", "purchase-order")).toBe("/print/projects/p/purchase-order")
    expect(printSourcePath("p", "rfq")).toBe("/print/projects/p/rfq/source")
  })

  it("knows its documents", () => {
    expect(isPrintDocument("rfq")).toBe(true)
    expect(isPrintDocument("toString")).toBe(false)
  })
})
