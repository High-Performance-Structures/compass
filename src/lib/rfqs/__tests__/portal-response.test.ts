import { describe, expect, it } from "vitest"

import {
  isPortalVisibleRfqStatus,
  parsePortalRfqPayload,
  portalRfqMatchesRecipient,
  withPortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

describe("sub/vendor RFQ portal", () => {
  it("fails closed when an RFQ targets another vendor", () => {
    expect(
      portalRfqMatchesRecipient({
        recipientEmail: "quotes@other.example",
        companyName: "Other Electric",
        assigneeName: "Other Electric",
        viewerEmail: "estimating@acme.example",
        viewerCompanyName: "Acme Framing",
        viewerDisplayName: "Alex Vendor",
      })
    ).toBe(false)
  })

  it("treats an explicit recipient email as authoritative", () => {
    expect(
      portalRfqMatchesRecipient({
        recipientEmail: "another-estimator@acme.example",
        companyName: "Acme Framing",
        assigneeName: "Acme Framing",
        viewerEmail: "alex@acme.example",
        viewerCompanyName: "Acme Framing",
        viewerDisplayName: "Alex Vendor",
      })
    ).toBe(false)
  })

  it("matches a targeted vendor by email or company", () => {
    expect(
      portalRfqMatchesRecipient({
        recipientEmail: "estimating@acme.example",
        companyName: null,
        assigneeName: null,
        viewerEmail: "estimating@acme.example",
        viewerCompanyName: "Acme Framing",
        viewerDisplayName: "Alex Vendor",
      })
    ).toBe(true)
    expect(
      portalRfqMatchesRecipient({
        recipientEmail: null,
        companyName: "Acme Framing, LLC",
        assigneeName: null,
        viewerEmail: "alex@acme.example",
        viewerCompanyName: "Acme Framing LLC",
        viewerDisplayName: "Alex Vendor",
      })
    ).toBe(true)
  })

  it("keeps draft RFQs private", () => {
    expect(isPortalVisibleRfqStatus("draft")).toBe(false)
    expect(isPortalVisibleRfqStatus("sent")).toBe(true)
    expect(isPortalVisibleRfqStatus("response_received")).toBe(true)
  })

  it("preserves the RFQ package when a vendor submits a response", () => {
    const original = JSON.stringify({
      vendorCategory: "Framing",
      scopeItems: [{ lineNumber: 1, description: "Frame the garage" }],
    })
    const updated = withPortalRfqVendorResponse(original, {
      decision: "quote",
      amount: 12500,
      lines: [
        { lineNumber: 1, amount: 10_000, notes: "Base scope" },
        { lineNumber: 2, amount: 2_500, notes: null },
      ],
      leadTime: "3 weeks",
      validUntil: "2026-09-30",
      notes: "Includes crane time.",
      responderUserId: "user-vendor",
      responderName: "Alex Vendor",
      responderCompany: "Acme Framing",
      submittedAt: "2026-08-19T12:00:00.000Z",
    })
    const parsed = parsePortalRfqPayload(updated)

    expect(parsed.vendorCategory).toBe("Framing")
    expect(parsed.scopeItems[0]?.description).toBe("Frame the garage")
    expect(parsed.vendorResponse?.amount).toBe(12500)
    expect(parsed.vendorResponse?.lines).toEqual([
      { lineNumber: 1, amount: 10_000, notes: "Base scope" },
      { lineNumber: 2, amount: 2_500, notes: null },
    ])
  })
})
