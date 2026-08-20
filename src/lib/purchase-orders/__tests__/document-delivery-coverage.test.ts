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

  it("loads the project address for the sent email document", () => {
    const action = source("src/app/actions/project-operations.ts")

    expect(action).toContain("address: projects.address")
    expect(action).toContain("deliveryLocation: resolvedPurchaseOrderShipTo")
    expect(action).toContain("text: purchaseOrderEmailText(emailInput)")
    expect(action).toContain("html: purchaseOrderEmailHtml(emailInput)")
  })
})
