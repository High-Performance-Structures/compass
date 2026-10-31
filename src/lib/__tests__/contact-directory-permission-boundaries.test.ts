import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function actionSource(name: string): string {
  return readFileSync(join(process.cwd(), "src/app/actions", name), "utf8")
}

function domainSource(name: string): string {
  return readFileSync(join(process.cwd(), "src/lib/domain/contacts", name), "utf8")
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
      .toBeLessThan(intake?.indexOf("await resolveIntakeCustomer(") ?? 0)
  })

  it("does not expose or assign denied directories through project contact actions", () => {
    const contacts = actionSource("project-contacts.ts")
    const picker = contacts.split("export async function getProjectContactDirectoryOptions(")[1]
      ?.split("export async function ")[0]
    for (const feature of ["customers", "vendors", "internal-directory"]) {
      expect(picker).toContain(`canFeature(user, "${feature}", "read")`)
    }
    expect(picker).toContain("customers: canViewCustomers, vendors: canViewVendors, internal: canViewInternal")
    const options = domainSource("directory-options.ts")
      .split("export async function loadProjectContactDirectoryOptions(")[1]
      ?.split("export async function ")[0]
    expect(options).toContain("grants.customers\n      ? db")
    expect(options).toContain("isNull(customers.mergedIntoCustomerId)")
    expect(options).toContain("grants.vendors\n      ? db")
    expect(options).toContain("grants.internal\n      ? db")

    const save = domainSource("save-contact.ts")
    const selection = save.split("async function resolveDirectorySelection(")[1]
      ?.split("\nasync function ")[0]
    expect(selection).toContain("const unchangedDirectorySelection = isUnchangedProjectContactDirectorySelection(")
    expect(selection).toContain("if (!unchangedDirectorySelection) {")
    expect(selection).toContain('await requireFeaturePermission(user, directoryFeature, "read")')
    expect(selection?.indexOf('await requireFeaturePermission(user, directoryFeature, "read")'))
      .toBeLessThan(selection?.indexOf("input.directorySourceType === \"customer\"\n      ? await selectCustomer") ?? 0)
    expect(save).toContain("isNull(customers.mergedIntoCustomerId)")
  })

  it("excludes archived merge sources from project association and project intake", () => {
    expect(actionSource("contact-project-associations.ts")).toContain("isNull(customers.mergedIntoCustomerId)")
    // Intake's client lookups moved to the project domain module.
    const intake = readFileSync(join(process.cwd(), "src/lib/domain/project/intake.ts"), "utf8")
    const resolveCustomer = intake.split("export async function resolveIntakeCustomer(")[1]
      ?.split("export async function ")[0] ?? ""
    expect(resolveCustomer.match(/isNull\(customers\.mergedIntoCustomerId\)/g)).toHaveLength(2)
    expect(readFileSync(join(process.cwd(), "src/lib/domain/project/intake-shell.ts"), "utf8"))
      .toContain("isNull(customers.mergedIntoCustomerId)")
  })
})
