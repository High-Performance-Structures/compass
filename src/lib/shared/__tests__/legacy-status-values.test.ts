import { describe, expect, it } from "vitest"

import { ESTIMATE_LISTS, ESTIMATE_STATUSES, STORED_ESTIMATE_STATUSES } from "@/lib/domain/estimates/statuses"
import { isEstimateStatus } from "@/lib/domain/estimates/rules"
import { STORED_USER_ROLES, USER_ROLES } from "@/lib/domain/identity/statuses"
import { SCHEDULE_LINK_TYPES, STORED_SCHEDULE_LINK_TYPES } from "@/lib/domain/schedule/statuses"
import { getPermissions, type Resource } from "@/lib/permissions"
import { isScheduleLinkType } from "@/lib/schedule/links"
import { assertListFields, isListValue } from "@/lib/shared/statuses"
import {
  canManageUserAccessRole,
  canUseOrganizationProjectScopeRole,
  isExternalProjectRole,
  isInternalStaffRole,
} from "@/lib/user-roles"

/*
 * Values found in production that no current writer produces. They are on the
 * stored lists (so the column type and store checks accept existing rows) but
 * not on the workflow lists, so every reader treats them exactly as it did
 * before the lists existed: as an unknown value.
 */

const RESOURCES: readonly Resource[] = ["project", "schedule", "budget"]

describe("users.role integration", () => {
  it("is stored but never offered or assigned", () => {
    expect(STORED_USER_ROLES).toContain("integration")
    expect(isListValue(USER_ROLES, "integration")).toBe(false)
    expect(() => assertListFields("users", { role: "integration" }, { role: STORED_USER_ROLES })).not.toThrow()
  })

  it("gets the same permissions and staff checks as any unknown role", () => {
    const unknown = "role-that-does-not-exist"
    expect(isInternalStaffRole("integration")).toBe(isInternalStaffRole(unknown))
    expect(isInternalStaffRole("integration")).toBe(false)
    expect(isExternalProjectRole("integration")).toBe(false)
    expect(canManageUserAccessRole("integration")).toBe(false)
    expect(canUseOrganizationProjectScopeRole("integration")).toBe(false)
    for (const resource of RESOURCES) {
      expect(getPermissions("integration", resource)).toEqual(getPermissions(unknown, resource))
    }
  })
})

describe("project_estimates.status sent", () => {
  it("is stored but is not a workflow status, so screens and edit checks treat it as before", () => {
    expect(STORED_ESTIMATE_STATUSES).toContain("sent")
    expect(ESTIMATE_STATUSES).not.toContain("sent")
    expect(isEstimateStatus("sent")).toBe(false)
    expect(() => assertListFields("project_estimates", { status: "sent" }, ESTIMATE_LISTS)).not.toThrow()
    expect(() => assertListFields("project_estimates", { status: "Sent" }, ESTIMATE_LISTS)).toThrow()
  })
})

describe("schedule_task_links.resource_type Buildertrend links", () => {
  it("are stored but stay hidden from the staff link list", () => {
    for (const value of ["buildertrend", "buildertrend_schedule"]) {
      expect(STORED_SCHEDULE_LINK_TYPES).toContain(value)
      expect(isListValue(SCHEDULE_LINK_TYPES, value)).toBe(false)
      expect(isScheduleLinkType(value)).toBe(false)
    }
  })
})
