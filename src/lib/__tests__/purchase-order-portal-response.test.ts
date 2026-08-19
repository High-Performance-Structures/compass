import { describe, expect, it } from "vitest"

import {
  isPortalVisiblePurchaseOrderStatus,
  parsePortalPurchaseOrderPayload,
  portalPurchaseOrderCanReceiveResponse,
  portalPurchaseOrderMatchesRecipient,
  withPortalPurchaseOrderAcknowledgement,
  withPortalPurchaseOrderRecipients,
} from "@/lib/purchase-orders/portal-response"

describe("purchase order portal response", () => {
  it("preserves the Sage payload while adding delivery and acknowledgement data", () => {
    const delivered = withPortalPurchaseOrderRecipients(
      JSON.stringify({ source: "compass_po_request", header: { vendorId: "12" } }),
      ["Purchasing@Vendor.com"]
    )
    const acknowledged = withPortalPurchaseOrderAcknowledgement(delivered, {
      responderUserId: "user-1",
      responderName: "Pat Vendor",
      responderCompany: "Vendor Co",
      note: "Received",
      submittedAt: "2026-08-19T18:00:00.000Z",
    })
    const raw: unknown = JSON.parse(acknowledged)
    expect(raw).toMatchObject({
      source: "compass_po_request",
      header: { vendorId: "12" },
    })
    expect(parsePortalPurchaseOrderPayload(acknowledged)).toEqual({
      recipientEmails: ["purchasing@vendor.com"],
      acknowledgement: {
        responderUserId: "user-1",
        responderName: "Pat Vendor",
        responderCompany: "Vendor Co",
        note: "Received",
        submittedAt: "2026-08-19T18:00:00.000Z",
      },
    })
  })

  it("treats explicit delivery emails as authoritative", () => {
    expect(
      portalPurchaseOrderMatchesRecipient({
        recipientEmails: ["orders@vendor.com"],
        companyName: "Vendor Co",
        assigneeName: null,
        vendorName: "Vendor Co",
        viewerEmail: "someone@vendor.com",
        viewerCompanyName: "Vendor Co",
        viewerDisplayName: "Someone",
      })
    ).toBe(false)
  })

  it("falls back to the assigned company for legacy purchase orders", () => {
    expect(
      portalPurchaseOrderMatchesRecipient({
        recipientEmails: [],
        companyName: "Vendor Co., LLC",
        assigneeName: null,
        vendorName: null,
        viewerEmail: "someone@vendor.com",
        viewerCompanyName: "Vendor Co LLC",
        viewerDisplayName: "Someone",
      })
    ).toBe(true)
  })

  it("exposes only issued POs and stops responses after receipt", () => {
    expect(isPortalVisiblePurchaseOrderStatus("draft")).toBe(false)
    expect(isPortalVisiblePurchaseOrderStatus("approved")).toBe(false)
    expect(isPortalVisiblePurchaseOrderStatus("sent")).toBe(true)
    expect(portalPurchaseOrderCanReceiveResponse("ordered")).toBe(true)
    expect(portalPurchaseOrderCanReceiveResponse("received")).toBe(false)
  })
})
