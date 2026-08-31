import { describe, expect, it } from "vitest"
import type { AuthUser } from "@/lib/auth"
import { DEMO_USER } from "@/lib/demo"
import {
  accessLevelToFeatureActions,
  canCreateProject,
  canManageWorkCalendarEvents,
  canUseAskCompass,
  canUseExecutiveAdmin,
  canUseFieldDesk,
  canUseOfficeTalk,
} from "@/lib/permissions"

function userWithRole(role: string): AuthUser {
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
  }
}

describe("canCreateProject", () => {
  it.each([
    "admin",
    "secondary_admin",
    "executive",
    "office",
    "office_manager",
    "project_manager",
    "project_administrator",
    "assistant_project_manager",
    "architectural_designer",
    "drafter",
    "lead_estimator",
    "assistant_estimator",
    "coordinator",
    "accounting",
  ])("allows active project-create role %s", (role) => {
    expect(canCreateProject(userWithRole(role))).toBe(true)
  })

  it.each([
    "field_superintendent",
    "field_crew",
    "field",
    "developer",
    "client",
    "subcontractor",
    "supplier",
    "guest",
    "unknown",
  ])("denies non-project-create role %s", (role) => {
    expect(canCreateProject(userWithRole(role))).toBe(false)
  })

  it("denies inactive, unauthenticated, and demo users", () => {
    expect(
      canCreateProject({
        ...userWithRole("assistant_project_manager"),
        isActive: false,
      }),
    ).toBe(false)
    expect(canCreateProject(null)).toBe(false)
    expect(canCreateProject(DEMO_USER)).toBe(false)
  })
})

describe("canUseAskCompass", () => {
  it("allows active staff roles with agent read permission", () => {
    expect(canUseAskCompass(userWithRole("admin"))).toBe(true)
    expect(canUseAskCompass(userWithRole("office"))).toBe(true)
    expect(canUseAskCompass(userWithRole("field"))).toBe(true)
  })

  it("always denies guests", () => {
    expect(canUseAskCompass(userWithRole("guest"))).toBe(false)
  })

  it("denies inactive, unauthenticated, and unpermitted users", () => {
    const inactiveAdmin = {
      ...userWithRole("admin"),
      isActive: false,
    }

    expect(canUseAskCompass(inactiveAdmin)).toBe(false)
    expect(canUseAskCompass(userWithRole("client"))).toBe(false)
    expect(canUseAskCompass(null)).toBe(false)
  })
})

describe("canUseFieldDesk", () => {
  it.each([
    "admin",
    "secondary_admin",
    "office",
    "project_manager",
    "field",
    "field_superintendent",
    "field_crew",
  ])(
    "allows active internal role %s",
    (role) => {
      expect(canUseFieldDesk(userWithRole(role))).toBe(true)
    },
  )

  it.each([
    "developer",
    "subcontractor",
    "supplier",
    "client",
    "guest",
    "unknown",
  ])(
    "denies external or unknown role %s",
    (role) => {
      expect(canUseFieldDesk(userWithRole(role))).toBe(false)
    },
  )

  it("denies inactive and unauthenticated users", () => {
    expect(
      canUseFieldDesk({
        ...userWithRole("field"),
        isActive: false,
      }),
    ).toBe(false)
    expect(canUseFieldDesk(null)).toBe(false)
  })
})

describe("canUseOfficeTalk", () => {
  it.each([
    "admin",
    "secondary_admin",
    "office",
    "project_manager",
    "field_superintendent",
  ])("allows active staff role %s", (role) => {
    expect(canUseOfficeTalk(userWithRole(role))).toBe(true)
  })

  it.each([
    "developer",
    "subcontractor",
    "supplier",
    "client",
    "guest",
    "unknown",
  ])("denies external or non-staff role %s", (role) => {
    expect(canUseOfficeTalk(userWithRole(role))).toBe(false)
  })

  it("keeps the production meeting out of the demo workspace", () => {
    expect(canUseOfficeTalk(DEMO_USER)).toBe(false)
  })
})

describe("canUseExecutiveAdmin", () => {
  it.each([
    "martine@hps-colorado.com",
    "martine@openrangeconstruction.com",
    "dan@hps-colorado.com",
  ])("allows approved Executive Admin identity %s", (email) => {
    expect(
      canUseExecutiveAdmin({
        ...userWithRole("office"),
        email,
      }),
    ).toBe(true)
  })

  it("does not trust an administrator-editable Google email override", () => {
    expect(
      canUseExecutiveAdmin({
        ...userWithRole("admin"),
        googleEmail: "martine@hps-colorado.com",
      }),
    ).toBe(false)
  })

  it("does not grant access from a broad admin role", () => {
    expect(canUseExecutiveAdmin(userWithRole("admin"))).toBe(false)
  })

  it("denies approved identities outside the active internal workspace", () => {
    const martine = {
      ...userWithRole("admin"),
      email: "martine@hps-colorado.com",
    }

    expect(canUseExecutiveAdmin({ ...martine, isActive: false })).toBe(false)
    expect(
      canUseExecutiveAdmin({ ...martine, organizationType: "client" }),
    ).toBe(false)
    expect(canUseExecutiveAdmin(null)).toBe(false)
  })
})

describe("canManageWorkCalendarEvents", () => {
  it.each([
    "admin",
    "secondary_admin",
    "office",
    "office_manager",
    "project_manager",
    "project_administrator",
    "assistant_project_manager",
  ])(
    "allows calendar management for %s",
    (role) => {
      expect(canManageWorkCalendarEvents(userWithRole(role))).toBe(true)
    },
  )

  it.each(["field", "client", "guest", "unknown"])(
    "does not inherit calendar management from broad schedule access for %s",
    (role) => {
      expect(canManageWorkCalendarEvents(userWithRole(role))).toBe(false)
    },
  )

  it("denies inactive and unauthenticated users", () => {
    expect(
      canManageWorkCalendarEvents({
        ...userWithRole("admin"),
        isActive: false,
      }),
    ).toBe(false)
    expect(canManageWorkCalendarEvents(null)).toBe(false)
  })
})

describe("social publishing feature baseline", () => {
  it("lets social editors publish without inheriting delete authority", () => {
    expect(accessLevelToFeatureActions("social-publishing", "edit")).toEqual([
      "create",
      "read",
      "update",
      "approve",
    ])
  })

  it("does not broaden read-only or unrelated feature permissions", () => {
    expect(accessLevelToFeatureActions("social-publishing", "view")).toEqual(["read"])
    expect(accessLevelToFeatureActions("social-publishing", "delete")).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "approve",
    ])
    expect(accessLevelToFeatureActions("project-hub", "edit")).toEqual([
      "create",
      "read",
      "update",
    ])
  })
})
