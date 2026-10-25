import { describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { canOpenProjectFiles } from "@/lib/project-files-access"
import { isInternalStaffRole } from "@/lib/user-roles"

function user(role: string, isActive = true): AuthUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    firstName: null,
    lastName: null,
    displayName: role,
    avatarUrl: null,
    role,
    googleEmail: null,
    isActive,
    lastLoginAt: null,
    organizationId: "org",
    organizationName: "Organization",
    organizationType: isInternalStaffRole(role) ? "internal" : "client",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
  }
}

describe("canOpenProjectFiles", () => {
  it("allows internal staff who can read documents, matching the Plans & Documents page", () => {
    const admin = user("admin")
    expect(can(admin, "document", "read")).toBe(true)
    expect(canOpenProjectFiles(admin)).toBe(true)
  })

  it("never offers project files to owners, clients, vendors or guests", () => {
    for (const role of ["client", "owner", "subcontractor", "supplier", "guest"]) {
      expect(canOpenProjectFiles(user(role))).toBe(false)
    }
  })

  it("is false for no one signed in or an inactive account", () => {
    expect(canOpenProjectFiles(null)).toBe(false)
    expect(canOpenProjectFiles(user("admin", false))).toBe(false)
  })
})
