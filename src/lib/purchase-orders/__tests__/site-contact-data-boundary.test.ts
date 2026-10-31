import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("purchase order site contact data boundary", () => {
  it("loads staff phone numbers only through the purchase-order-specific action", () => {
    const domain = source("src/lib/domain/contacts/assignees.ts")
    const genericStart = domain.indexOf(
      "export async function loadProjectTaskAssigneeOptions"
    )
    const siteContactStart = domain.indexOf(
      "export async function loadPurchaseOrderSiteContactOptions"
    )
    const siteContactEnd = domain.indexOf("export async function", siteContactStart + 1)

    expect(genericStart).toBeGreaterThan(-1)
    expect(siteContactStart).toBeGreaterThan(genericStart)
    expect(domain.slice(0, siteContactStart)).not.toContain(
      "phone: users.phone"
    )
    expect(domain.slice(siteContactEnd)).not.toContain("phone: users.phone")
    expect(domain.slice(siteContactStart, siteContactEnd)).toContain("phone: users.phone")

    const actions = source("src/app/actions/project-contact-assignees.ts")
    const siteContactAction = actions.slice(
      actions.indexOf("export async function getProjectPurchaseOrderSiteContactOptions")
    )
    expect(siteContactAction).toContain(
      'requireFeaturePermission(user, "purchase-orders", "read")'
    )
    expect(siteContactAction).toContain("loadPurchaseOrderSiteContactOptions(")
  })

  it("passes the narrow phone-aware options only to purchase-order forms", () => {
    const page = source(
      "src/app/dashboard/projects/[id]/purchase-orders/page.tsx"
    )

    expect(page).toContain("getProjectPurchaseOrderSiteContactOptions(id)")
    expect(page).toContain("siteContactOptions={siteContactOptions}")
  })
})
