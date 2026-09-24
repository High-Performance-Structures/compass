import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function actionSource(name: string): string {
  return readFileSync(join(process.cwd(), "src/app/actions", name), "utf8")
}

describe("contact directory permission boundaries", () => {
  it("enforces distinct feature grants for client and vendor mutations", () => {
    const customers = actionSource("customers.ts")
    const vendors = actionSource("vendors.ts")
    for (const action of ["create", "update", "delete"] as const) {
      expect(customers).toContain(`requireFeaturePermission(user, "customers", "${action}")`)
      expect(vendors).toContain(`requireFeaturePermission(user, "vendors", "${action}")`)
    }
    expect(vendors).toContain('requireFeaturePermission(user, "internal-directory", "read")')
  })

  it("keeps bulk project grants scoped to an organization and selected account IDs", () => {
    const users = actionSource("users.ts")
    const grant = users.split("export async function grantContactsProjectAccess")[1]
      ?.split("export async function assignUserToTeam")[0]
    expect(grant).toContain("new Set(userIds)")
    expect(grant).toContain("eq(projects.organizationId, currentUser.organizationId)")
    expect(grant).toContain("eq(organizationMembers.organizationId, currentUser.organizationId)")
    expect(grant).toContain("getUserAvailabilityCondition(true)")
  })
})
