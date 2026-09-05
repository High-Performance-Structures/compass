import { describe, expect, it } from "vitest"

import {
  parsePortalPurchaseOrderPayload,
  portalPurchaseOrderCanReceiveResponse,
  portalPurchaseOrderMatchesRecipient,
  validPortalPurchaseOrderVendorStatus,
  withPortalPurchaseOrderStatusUpdate,
} from "@/lib/purchase-orders/portal-response"

describe("purchase order portal responses", () => {
  it("uses explicit recipient emails instead of a company-name fallback", () => {
    expect(
      portalPurchaseOrderMatchesRecipient({
        recipientEmails: ["assigned@example.com"],
        companyName: "Example Vendor",
        assigneeName: null,
        vendorName: null,
        viewerEmail: "other@example.com",
        viewerCompanyName: "Example Vendor",
        viewerDisplayName: "Other Person",
      })
    ).toBe(false)
  })

  it("matches the assigned company when no delivery email is present", () => {
    expect(
      portalPurchaseOrderMatchesRecipient({
        recipientEmails: [],
        companyName: "Example Vendor, LLC",
        assigneeName: null,
        vendorName: null,
        viewerEmail: "vendor@example.com",
        viewerCompanyName: "Example Vendor LLC",
        viewerDisplayName: "Vendor User",
      })
    ).toBe(true)
  })

  it("appends and parses vendor status history without losing source data", () => {
    const updated = withPortalPurchaseOrderStatusUpdate(
      JSON.stringify({ sageRecordId: "po-1" }),
      {
        status: "processing",
        responderUserId: "user-1",
        responderName: "Vendor User",
        responderCompany: "Example Vendor",
        note: "Materials are being prepared.",
        submittedAt: "2026-09-03T12:00:00.000Z",
      }
    )
    const parsed = parsePortalPurchaseOrderPayload(updated)
    expect(parsed.latestStatus?.status).toBe("processing")
    expect(parsed.statusHistory).toHaveLength(1)
    expect(JSON.parse(updated)).toMatchObject({ sageRecordId: "po-1" })
  })

  it("validates supported operational statuses", () => {
    expect(validPortalPurchaseOrderVendorStatus("fulfilled")).toBe("fulfilled")
    expect(validPortalPurchaseOrderVendorStatus("accepted")).toBeNull()
  })

  it("blocks vendor responses after a canonical PO is closed", () => {
    expect(portalPurchaseOrderCanReceiveResponse("ordered")).toBe(true)
    expect(portalPurchaseOrderCanReceiveResponse("closed")).toBe(false)
  })
})
