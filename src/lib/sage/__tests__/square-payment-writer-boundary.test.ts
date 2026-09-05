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
const squarePaymentSource = source("../square-payment.ts")
const notificationSource = source("../square-payment-notifications.ts")
const receiptActions = source("../../../app/actions/sage-square-receipts.ts")

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

  it("requires an active Compass project before storing a Square receipt", () => {
    expect(squarePaymentSource).toContain("resolveActiveCompassProject")
    expect(squarePaymentSource).toContain(
      'envString(env, "SAGE_SQUARE_ORGANIZATION_ID")'
    )
    expect(squarePaymentSource).toContain(
      "eq(projects.organizationId, organizationId)"
    )
    expect(squarePaymentSource).toContain('eq(projects.status, "OPEN")')
    expect(squarePaymentSource).toContain("organization_id, project_id")
  })

  it("scopes receipt notifications to the matched organization and project", () => {
    expect(notificationSource).toContain(
      "eq(organizationMembers.organizationId, input.organizationId)"
    )
    expect(notificationSource).toContain("projectId: input.projectId")
    expect(notificationSource).toContain(
      "encodeURIComponent(input.receiptOperationId)"
    )
    expect(notificationSource).toContain("squareReceipt=")
  })

  it("retains project scope on refund and payment-change exceptions", () => {
    expect(squarePaymentSource).toContain(
      '"Square bridge payment changed or was refunded",\n      scope'
    )
    expect(squarePaymentSource).toContain(
      '`Square reported ${event.type} for a Sage bridge invoice`,\n      scope'
    )
  })

  it("notifies the configured organization when no project can be resolved", () => {
    expect(squarePaymentSource).toContain(
      "{ organizationId, projectId: null }"
    )
    expect(notificationSource).toContain(
      ': "/dashboard/financials?tab=payments"'
    )
  })

  it("hydrates legacy receipt scope from the original Square invoice", () => {
    expect(squarePaymentSource).toContain(
      "contextFromReceiptWithLegacyHydration"
    )
    expect(squarePaymentSource).toContain("retrieveInvoice(env")
    expect(squarePaymentSource).toContain(
      "sageJobShortName: invoice.sageJobShortName"
    )
    expect(receiptActions).toContain("hydrateLegacySageSquarePaymentScopes")
    expect(resultsRoute).toContain("hydrateLegacySageSquarePaymentScopes")
  })
})
