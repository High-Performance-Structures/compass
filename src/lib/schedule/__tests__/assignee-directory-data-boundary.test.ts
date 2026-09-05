import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8")
}

describe("schedule assignee directory data boundary", () => {
  it("loads the complete Compass directory with schedule permissions", () => {
    const actions = source("src/app/actions/project-contacts.ts")
    const scheduleStart = actions.indexOf(
      "export async function getScheduleTaskAssigneeOptions"
    )
    const nextActionStart = actions.indexOf(
      "export async function getProjectPurchaseOrderSiteContactOptions",
      scheduleStart
    )
    const scheduleAction = actions.slice(scheduleStart, nextActionStart)

    expect(scheduleStart).toBeGreaterThan(-1)
    expect(nextActionStart).toBeGreaterThan(scheduleStart)
    expect(scheduleAction).toContain(
      'requireFeaturePermission(user, "schedule", "update")'
    )
    expect(scheduleAction).toContain(".from(customers)")
    expect(scheduleAction).toContain(".from(vendors)")
    expect(scheduleAction).toContain(".from(vendorContacts)")
    expect(scheduleAction).toContain(".from(organizationMembers)")
    expect(scheduleAction).toContain("customerRows.map(customerToTaskAssigneeOption)")
    expect(scheduleAction).toContain("vendorRows.map(directoryContactToTaskAssigneeOption)")
    expect(scheduleAction).toContain("vendorContactRows.map(")
    expect(scheduleAction).toContain("uniqueInternalStaffMembers(organizationUserRows)")
    expect(scheduleAction).not.toContain("projectSourceVendorIds")
    expect(scheduleAction).not.toContain("projectNameKeys")
  })

  it("uses the schedule-specific directory loader on project schedule pages", () => {
    const projectPage = source(
      "src/app/dashboard/projects/[id]/schedule/page.tsx"
    )
    const portfolioPage = source("src/app/dashboard/schedule/page.tsx")

    expect(projectPage).toContain("getScheduleTaskAssigneeOptions(id)")
    expect(projectPage).not.toContain("getProjectTaskAssigneeOptions(id)")
    expect(portfolioPage).toContain(
      "getScheduleTaskAssigneeOptions(\n          primaryProject.id\n        )"
    )
    expect(portfolioPage).toContain("assigneeOptions={assigneeOptions}")
  })
})
