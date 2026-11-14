import { describe, expect, it } from "vitest"

import { rfqRecipientPortalResponse } from "@/lib/domain/operations/rfq-recipients"
import { vendorPortalRfq, type VendorPortalRfqRow } from "@/lib/rfqs/vendor-portal-rfq"

/*
 * Vendors see a Buildertrend RFQ only when their company answered it, and see
 * only their own answer: never the package description (it can name another
 * bidder's price), never notes, never another vendor's response.
 */

const importedRow: VendorPortalRfqRow = {
  id: "bt-rfq-op-1-2",
  sourceSystem: "buildertrend",
  sourceRecordNumber: null,
  title: "Cabinetry",
  description: "Designer Kitchens bid $8,975.00. Imported from staging.",
  status: "closed",
  priority: "normal",
  companyName: null,
  assigneeName: null,
  dueDate: null,
  amount: 8975,
  sagePayloadJson: JSON.stringify({
    scopeItems: [{ lineNumber: 1, description: "Casework", costCode: "06 41 00", notes: "source cost type Other" }],
    documentLinks: [{ lineNumber: 1, label: "Plans.pdf", url: "https://drive.google.com/file/d/x/view", notes: "internal note" }],
  }),
}

const viewer = { email: "bids@frontrange.example", companyName: "Front Range Cabinets", displayName: "Dana" }

const ownQuote = rfqRecipientPortalResponse(
  { id: "r1", rfqOperationId: importedRow.id, responseStatus: "quoted", quoteAmountCents: 1981698, respondedAt: "2024-06-18", enteredByBuilder: false },
  "Front Range Cabinets"
)

describe("vendor portal RFQ", () => {
  it("hides an imported RFQ from a vendor who is not a recipient", () => {
    expect(vendorPortalRfq(importedRow, viewer, null)).toBeNull()
  })

  it("shows a recorded recipient only its own quote, with no description, notes or row amount", () => {
    const view = vendorPortalRfq(importedRow, viewer, ownQuote)
    expect(view).not.toBeNull()
    expect(view?.description).toBeNull()
    expect(view?.amount).toBeNull()
    expect(view?.companyName).toBeNull()
    expect(view?.scopeItems).toEqual([{ lineNumber: 1, description: "Casework", costCode: "06 41 00", phaseCode: null, notes: null }])
    expect(view?.documentLinks.map((link) => link.notes)).toEqual([null])
    expect(view?.vendorResponse).toMatchObject({ decision: "quote", amount: 19816.98, submittedAt: "2024-06-18" })
    expect(JSON.stringify(view)).not.toContain("8,975")
  })

  it("shows a decline and a priceless quote without inventing an amount", () => {
    const decline = rfqRecipientPortalResponse(
      { id: "r2", rfqOperationId: importedRow.id, responseStatus: "declined", quoteAmountCents: null, respondedAt: null, enteredByBuilder: false },
      "Front Range Cabinets"
    )
    expect(vendorPortalRfq(importedRow, viewer, decline)?.vendorResponse).toMatchObject({ decision: "decline", amount: null, submittedAt: "" })
    const builderEntered = rfqRecipientPortalResponse(
      { id: "r3", rfqOperationId: importedRow.id, responseStatus: "quoted", quoteAmountCents: null, respondedAt: null, enteredByBuilder: true },
      "Front Range Cabinets"
    )
    expect(builderEntered).toMatchObject({ decision: "quote", amount: null, notes: "Recorded by the builder from your quote." })
  })

  it("never shows a recorded recipient the row's own response for another vendor", () => {
    const row: VendorPortalRfqRow = {
      ...importedRow,
      sourceSystem: "compass",
      companyName: "Other Vendor LLC",
      sagePayloadJson: JSON.stringify({
        recipientEmail: "other@vendor.example",
        vendorResponse: { decision: "quote", amount: 5000, lines: [], responderUserId: "u-other", responderName: "Other", submittedAt: "2026-01-01" },
      }),
    }
    const view = vendorPortalRfq(row, viewer, ownQuote)
    expect(view?.vendorResponse?.amount).toBe(19816.98)
    expect(view?.companyName).toBeNull()
    expect(view?.amount).toBeNull()
    expect(vendorPortalRfq(row, viewer, null)).toBeNull()
  })

  it("never shows an imported row's amount, even to a vendor the row names", () => {
    const view = vendorPortalRfq({ ...importedRow, companyName: "Front Range Cabinets" }, viewer, null)
    expect(view?.amount).toBeNull()
    expect(view?.companyName).toBeNull()
    expect(view?.description).toBeNull()
  })

  it("treats template-made RFQs as Compass RFQs", () => {
    const view = vendorPortalRfq({ ...importedRow, sourceSystem: "compass_template", companyName: "Front Range Cabinets", description: "Template scope." }, viewer, null)
    expect(view?.description).toBe("Template scope.")
    expect(view?.scopeItems[0]?.notes).toBe("source cost type Other")
  })

  it("keeps Compass RFQs as written for the vendor they name", () => {
    const row: VendorPortalRfqRow = {
      ...importedRow,
      sourceSystem: "compass",
      description: "Please quote cabinets.",
      companyName: "Front Range Cabinets",
      amount: null,
    }
    const view = vendorPortalRfq(row, viewer, null)
    expect(view?.description).toBe("Please quote cabinets.")
    expect(view?.companyName).toBe("Front Range Cabinets")
    expect(view?.scopeItems[0]?.notes).toBe("source cost type Other")
  })
})
