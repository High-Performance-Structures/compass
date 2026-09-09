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
const receivableSource = source("../square-receivable.ts")
const maintenanceRoute = source(
  "../../../app/api/operations/sage/square-receipts/route.ts"
)
const financialWorkflowSource = source(
  "../../../app/actions/project-financial-workflows.ts"
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

  it("requires one exact Compass project and owner before storing a Square receipt", () => {
    expect(squarePaymentSource).toContain("resolveCompassProject")
    expect(squarePaymentSource).toContain(
      'envString(env, "SAGE_SQUARE_ORGANIZATION_ID")'
    )
    expect(squarePaymentSource).toContain(
      "eq(projects.organizationId, organizationId)"
    )
    expect(squarePaymentSource).not.toContain('eq(projects.status, "OPEN")')
    expect(squarePaymentSource).toContain("does not map to exactly one Compass owner")
    expect(squarePaymentSource).toContain("organization_id, project_id")
  })

  it("projects the exact Sage invoice and Square payment into Compass financials", () => {
    expect(receivableSource).toContain("sage-ar-invoice:")
    expect(receivableSource).toContain("square-payment:")
    expect(receivableSource).toContain("INSERT INTO invoices")
    expect(receivableSource).toContain("INSERT INTO payments")
    expect(receivableSource).toContain("INSERT INTO invoice_payment_allocations")
    expect(receivableSource).toContain("source_system = 'sage'")
    expect(financialWorkflowSource).toContain(
      'inArray(projectOperations.sourceSystem, ["buildertrend", "sage"])'
    )
  })

  it("retries eligible mapping exceptions through the authenticated maintenance route", () => {
    expect(squarePaymentSource).toContain("reconcileSageSquareAttentionEvents")
    expect(squarePaymentSource).toContain("retrieveInvoice(")
    expect(squarePaymentSource).toContain("dismissSageSquareException")
    expect(squarePaymentSource).toContain(
      "instr(error_message, 'does not map to exactly one active Compass project') > 0"
    )
    expect(squarePaymentSource).not.toContain(
      "error_message LIKE '%does not map to exactly one active Compass project%'"
    )
    expect(maintenanceRoute).toContain("reconcileSageSquareAttentionEvents")
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
