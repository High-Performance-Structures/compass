import { describe, expect, it } from "vitest"

import {
  normalizedNuTechTakeoffStatus,
  nuTechPurchaseOrderReleaseReadiness,
  nuTechReleaseAuditIssues,
  nuTechTakeoffAcknowledgementRequired,
} from "@/lib/nutech/workflow"

describe("Nu-Tech order workflow", () => {
  it("does not require an acknowledgement for customer-provided quantities", () => {
    expect(nuTechTakeoffAcknowledgementRequired("customer_provided")).toBe(false)
    expect(
      normalizedNuTechTakeoffStatus({
        quantitySource: "customer_provided",
        requestedStatus: "signed",
      })
    ).toBe("not_required")
  })

  it("requires a signed acknowledgement for staff takeoffs before PO release", () => {
    expect(nuTechTakeoffAcknowledgementRequired("staff_takeoff")).toBe(true)
    expect(
      nuTechPurchaseOrderReleaseReadiness({
        customerType: "returning",
        pricingMode: "cash_discount",
        quantitySource: "staff_takeoff",
        takeoffAcknowledgementStatus: "sent",
        airlitePurchaseOrderOperationId: "po-1",
      })
    ).toEqual({
      ready: false,
      issues: ["Obtain the signed takeoff acknowledgement."],
    })
  })

  it("allows a linked PO to release when the applicable intake checks are complete", () => {
    expect(
      nuTechPurchaseOrderReleaseReadiness({
        customerType: "new",
        pricingMode: "standard",
        quantitySource: "customer_provided",
        takeoffAcknowledgementStatus: "not_required",
        airlitePurchaseOrderOperationId: "po-2",
      })
    ).toEqual({ ready: true, issues: [] })
  })

  it("holds PO release until catalog items and a current Airlite workbook exist", () => {
    expect(
      nuTechPurchaseOrderReleaseReadiness({
        customerType: "new",
        pricingMode: "standard",
        quantitySource: "customer_provided",
        takeoffAcknowledgementStatus: "not_required",
        airlitePurchaseOrderOperationId: "po-2",
        orderItemCount: 0,
        airliteWorkbookStatus: "stale",
      })
    ).toEqual({
      ready: false,
      issues: [
        "Add at least one catalog item to the order.",
        "Generate the Airlite workbook from the saved order items.",
      ],
    })
  })

  it("requires release actions before audited release statuses can be saved", () => {
    expect(
      nuTechReleaseAuditIssues({
        orderStatus: "po_released",
        vendorInvoiceStatus: "not_received",
        purchaseOrderReleasedAt: null,
        vendorInvoiceReleasedAt: null,
      })
    ).toContain(
      "Record the Airlite PO release before selecting a post-release status."
    )
    expect(
      nuTechReleaseAuditIssues({
        orderStatus: "invoice_released",
        vendorInvoiceStatus: "released",
        purchaseOrderReleasedAt: "2026-08-24T12:00:00.000Z",
        vendorInvoiceReleasedAt: null,
      })
    ).toHaveLength(2)
  })

  it("keeps a released PO from moving back to intake", () => {
    expect(
      nuTechReleaseAuditIssues({
        orderStatus: "intake",
        vendorInvoiceStatus: "received",
        purchaseOrderReleasedAt: "2026-08-24T12:00:00.000Z",
        vendorInvoiceReleasedAt: null,
      })
    ).toEqual([
      "A released Airlite PO cannot be moved back to a pre-release status.",
    ])
  })

  it("keeps a released invoice in a final workflow state", () => {
    expect(
      nuTechReleaseAuditIssues({
        orderStatus: "vendor_confirmed",
        vendorInvoiceStatus: "released",
        purchaseOrderReleasedAt: "2026-08-24T12:00:00.000Z",
        vendorInvoiceReleasedAt: "2026-08-24T13:00:00.000Z",
      })
    ).toEqual([
      "A released vendor invoice can only remain released, complete, or cancelled.",
    ])
  })
})
