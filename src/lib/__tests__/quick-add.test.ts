import { describe, expect, it } from "vitest"
import type { AuthUser } from "@/lib/auth"
import {
  QUICK_ADD_ACTIONS,
  getQuickAddActions,
  quickAddHref,
  type QuickAddPermissions,
} from "@/lib/quick-add"

function userWithRole(role: string, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    firstName: null,
    lastName: null,
    displayName: role,
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org-1",
    organizationName: "Example",
    organizationType: "internal",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const allPermissions: QuickAddPermissions = {
  dailyLog: true,
  scheduleItem: true,
  todo: true,
}

describe("quick add actions", () => {
  it("exposes all approved actions for active internal staff", () => {
    expect(getQuickAddActions(userWithRole("office"), allPermissions)).toEqual(
      QUICK_ADD_ACTIONS,
    )
  })

  it.each([
    ["client", {}],
    ["subcontractor", {}],
    ["supplier", {}],
    ["guest", {}],
    ["office", { isActive: false }],
    ["office", { organizationId: null }],
    ["office", { organizationType: "client" }],
  ] as const)("fails closed for %s audience/state", (role, overrides) => {
    expect(getQuickAddActions(userWithRole(role, overrides), allPermissions)).toEqual([])
  })

  it("only exposes the permissioned destinations", () => {
    expect(
      getQuickAddActions(userWithRole("office"), {
        dailyLog: true,
        scheduleItem: false,
        todo: true,
      }),
    ).toEqual(["daily-log", "todo"])
  })

  it("builds project-scoped existing workflow URLs", () => {
    expect(quickAddHref("daily-log", "project-1")).toBe(
      "/dashboard/projects/project-1/daily-logs?quickAdd=daily-log",
    )
    expect(quickAddHref("schedule-item", "project-1")).toBe(
      "/dashboard/projects/project-1/schedule?quickAdd=schedule-item",
    )
    expect(quickAddHref("todo", "project-1")).toBe(
      "/dashboard/projects/project-1/todos?quickAdd=todo",
    )
  })
})
