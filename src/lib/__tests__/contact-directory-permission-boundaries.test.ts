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

  it("checks client directory access inside project intake, not only its picker", () => {
    const projects = actionSource("projects.ts")
    const intake = projects.split("export async function createProjectIntake(")[1]
      ?.split("export async function ")[0]
    expect(intake).toContain('requireFeaturePermission(user, "customers", "read")')
    expect(intake).toContain('requireFeaturePermission(user, "customers", "create")')
    expect(intake).toContain('if (cleanText(input.assignedTo)) {')
    expect(intake).toContain('requireFeaturePermission(user, "internal-directory", "read")')
    expect(intake?.indexOf('requireFeaturePermission(user, "customers", "read")'))
      .toBeLessThan(intake?.indexOf("const customerMatches =") ?? 0)
  })

  it("does not expose or assign denied directories through project contact actions", () => {
    const contacts = actionSource("project-contacts.ts")
    const picker = contacts.split("export async function getProjectContactDirectoryOptions(")[1]
      ?.split("export async function ")[0]
    for (const feature of ["customers", "vendors", "internal-directory"]) {
      expect(picker).toContain(`canFeature(user, "${feature}", "read")`)
    }
    expect(picker).toContain("canViewCustomers ? db")
    expect(picker).toContain("canViewVendors ? db")
    expect(picker).toContain("canViewInternal ? db")

    const save = contacts.split("export async function saveProjectContact(")[1]
      ?.split("export async function ")[0]
    expect(save).toContain("const unchangedDirectorySelection = isUnchangedProjectContactDirectorySelection(")
    expect(save).toContain("if (!unchangedDirectorySelection) {")
    expect(save).toContain('await requireFeaturePermission(user, directoryFeature, "read")')
    expect(save?.indexOf('await requireFeaturePermission(user, directoryFeature, "read")'))
      .toBeLessThan(save?.indexOf("if (input.directorySourceType === \"customer\")") ?? 0)
  })
})
