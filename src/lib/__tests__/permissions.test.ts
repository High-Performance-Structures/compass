import { describe, expect, it } from "vitest"
import type { AuthUser } from "@/lib/auth"
import {
  canManageWorkCalendarEvents,
  canUseAskCompass,
  canUseFieldDesk,
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
  it.each(["admin", "office", "field"])(
    "allows active internal role %s",
    (role) => {
      expect(canUseFieldDesk(userWithRole(role))).toBe(true)
    },
  )

  it.each(["secondary_admin", "client", "guest", "unknown"])(
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

describe("canManageWorkCalendarEvents", () => {
  it.each(["admin", "office"])(
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
