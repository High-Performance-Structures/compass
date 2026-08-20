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

    expect(page).toContain("resolvedPurchaseOrderShipTo")
    expect(page).toContain("Delivery Location")
    expect(page).toContain('{deliveryLocation ?? "TBD"}')
  })

  it("prints a matched vendor address instead of accounting metadata", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )
    const printStart = page.indexOf(
      '<div className="hidden text-[11px] leading-tight text-black print:block">'
    )
    const printEnd = page.indexOf("</article>", printStart)

    expect(printStart).toBeGreaterThan(-1)
    expect(printEnd).toBeGreaterThan(printStart)
    const printMarkup = page.slice(printStart, printEnd)
    expect(printMarkup).toContain("order.vendorAddress")
    expect(printMarkup).not.toContain("Vendor ID:")
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
