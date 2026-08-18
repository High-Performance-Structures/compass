import { describe, expect, it } from "vitest"

import { toSidebarUser, type AuthUser } from "@/lib/auth"
import { controlledDeskPhotoUrl } from "@/lib/user-photo-storage"

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "user-1",
    email: "person@example.com",
    firstName: "Example",
    lastName: "Person",
    displayName: "Example Person",
    avatarUrl: "https://drive.google.com/uc?id=avatar-drive-id",
    dashboardDeskPhotoUrl: controlledDeskPhotoUrl("dashboard", "dashboard-drive-id"),
    dashboardDeskPhotoOrganizationId: "org-internal",
    sidebarDeskPhotoUrl: controlledDeskPhotoUrl("sidebar", "sidebar-drive-id"),
    sidebarDeskPhotoOrganizationId: "org-internal",
    role: "client",
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org-internal",
    organizationName: "Client organization",
    organizationType: "client",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  }
}

describe("workspace photo delivery policy", () => {
  it("removes profile and desk photo capabilities from external sidebar props", () => {
    const sidebarUser = toSidebarUser(user())

    expect(sidebarUser.canUseWorkspacePhotos).toBe(false)
    expect(sidebarUser.avatar).toBeNull()
    expect(sidebarUser.dashboardDeskPhoto).toBeNull()
    expect(sidebarUser.sidebarDeskPhoto).toBeNull()
  })

  it("removes every photo capability from demo and inactive sidebar props", () => {
    const demoUser = toSidebarUser(
      user({ id: "demo-user-001", role: "admin", organizationType: "internal" })
    )
    const inactiveUser = toSidebarUser(
      user({
        id: "staff-1",
        role: "admin",
        organizationType: "internal",
        isActive: false,
      })
    )

    expect(demoUser.avatar).toBeNull()
    expect(demoUser.canUseWorkspacePhotos).toBe(false)
    expect(demoUser.dashboardDeskPhoto).toBeNull()
    expect(demoUser.sidebarDeskPhoto).toBeNull()
    expect(inactiveUser.avatar).toBeNull()
    expect(inactiveUser.canUseWorkspacePhotos).toBe(false)
    expect(inactiveUser.dashboardDeskPhoto).toBeNull()
    expect(inactiveUser.sidebarDeskPhoto).toBeNull()
  })

  it("keeps only current-organization controlled photos for active internal staff", () => {
    const sidebarUser = toSidebarUser(
      user({
        id: "staff-1",
        role: "admin",
        organizationType: "internal",
        dashboardDeskPhotoOrganizationId: "org-internal",
        sidebarDeskPhotoOrganizationId: "org-other",
      })
    )

    expect(sidebarUser.avatar).toBe("https://drive.google.com/uc?id=avatar-drive-id")
    expect(sidebarUser.canUseWorkspacePhotos).toBe(true)
    expect(sidebarUser.dashboardDeskPhoto).toBe(
      controlledDeskPhotoUrl("dashboard", "dashboard-drive-id")
    )
    expect(sidebarUser.sidebarDeskPhoto).toBeNull()
  })
})
