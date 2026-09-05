import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
}

const requestsRoute = source(
  "../../../app/api/integrations/sage/square-payments/requests/route.ts"
)
const resultsRoute = source(
  "../../../app/api/integrations/sage/square-payments/results/route.ts"
)
const schemaInspector = source(
  "../../../../scripts/inspect_sage_payment_mbxml.ps1"
)

describe("Sage Square payment writer boundary", () => {
  it("filters fee operations during both discovery and atomic claim", () => {
    expect(
      requestsRoute.match(/"post_square_processing_fee"/g)
    ).toHaveLength(2)
    expect(requestsRoute).not.toContain('"post_square_receipt"')
  })

  it("rejects any result for an operation outside the fee writer", () => {
    expect(resultsRoute).toContain("isSageSquareWriterOperation")
    expect(resultsRoute).toContain(
      "Only Square processing-fee operations may use this writer"
    )
  })

  it("uses the installed schema to distinguish A/R receipts from unrelated writes", () => {
    expect(schemaInspector).toContain("arReceiptWriteAvailable")
    expect(schemaInspector).toContain("generalLedgerWriteAvailable")
    expect(schemaInspector).toContain("Payment|Pay")
    expect(schemaInspector).not.toMatch(/INSERT|UPDATE|DELETE|submitXML/i)
  })
})
