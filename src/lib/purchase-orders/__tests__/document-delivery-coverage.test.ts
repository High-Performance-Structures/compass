import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("purchase order delivery output coverage", () => {
  it("renders the resolved delivery location in the printable PO", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )
    const document = source("src/components/projects/purchase-order-document.tsx")
    const driveCopy = source("src/lib/paper-trail/record-copy-data.ts")

    expect(page).toContain("resolvedPurchaseOrderShipTo")
    expect(page).toContain("<PurchaseOrderDocument")
    // The Drive copy resolves delivery and vendor details the same way.
    expect(driveCopy).toContain("resolvedPurchaseOrderShipTo")
    expect(driveCopy).toContain("purchaseOrderVendorDetails")
    expect(document).toContain("Delivery Location")
    expect(document).toContain('{deliveryLocation ?? "TBD"}')
  })

  it("prints a matched vendor address instead of accounting metadata", () => {
    // The whole shared document is the printed markup.
    const printMarkup = source("src/components/projects/purchase-order-document.tsx")
    expect(printMarkup).toContain("order.vendorAddress")
    expect(printMarkup).not.toContain("Vendor ID:")
  })

  it("prints the site contact name and phone instead of internal-owner metadata", () => {
    // The whole shared document is the printed markup.
    const printMarkup = source("src/components/projects/purchase-order-document.tsx")
    expect(printMarkup).toContain("Site Contact:")
    expect(printMarkup).toContain("order.siteContactPhone")
    expect(printMarkup).not.toContain("Internal Owner:")
  })

  it("loads the project address for the sent email document", () => {
    const action = source("src/app/actions/project-operations.ts")

    expect(action).toContain("address: projects.address")
    expect(action).toContain("deliveryLocation: resolvedPurchaseOrderShipTo")
    expect(action).toContain("text: purchaseOrderEmailText(emailInput)")
    expect(action).toContain("html: purchaseOrderEmailHtml(emailInput)")
  })

  it("loads vendor addresses for the printable document", () => {
    const action = source("src/app/actions/project-operations.ts")

    expect(action).toContain("address: projectContacts.address")
    expect(action).toContain("address: vendors.address")
    expect(action).toContain("purchaseOrderVendorDetails")
    expect(action).toContain("vendorAddress: vendorDetails.address")
  })
})
