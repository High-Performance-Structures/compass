import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("purchase order site contact data boundary", () => {
  it("loads staff phone numbers only through the purchase-order-specific action", () => {
    const actions = source("src/app/actions/project-contacts.ts")
    const genericStart = actions.indexOf(
      "export async function getProjectTaskAssigneeOptions"
    )
    const siteContactStart = actions.indexOf(
      "export async function getProjectPurchaseOrderSiteContactOptions"
    )

    expect(genericStart).toBeGreaterThan(-1)
    expect(siteContactStart).toBeGreaterThan(genericStart)
    expect(actions.slice(genericStart, siteContactStart)).not.toContain(
      "phone: users.phone"
    )
    const siteContactAction = actions.slice(siteContactStart)
    expect(siteContactAction).toContain(
      'requireFeaturePermission(user, "purchase-orders", "read")'
    )
    expect(siteContactAction).toContain("phone: users.phone")
  })

  it("passes the narrow phone-aware options only to purchase-order forms", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )

    expect(page).toContain("getProjectPurchaseOrderSiteContactOptions(id)")
    expect(page).toContain("siteContactOptions={siteContactOptions}")
  })
})
