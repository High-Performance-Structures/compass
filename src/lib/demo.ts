import type { AuthUser } from "./auth"

export const DEMO_ORG_ID = "demo-org-meridian"
export const DEMO_USER_ID = "demo-user-001"

export const DEMO_USER: AuthUser = {
  id: DEMO_USER_ID,
  email: "demo@compass.build",
  firstName: "Demo",
  lastName: "User",
  displayName: "Demo User",
  avatarUrl: null,
  dashboardDeskPhotoUrl: null,
  sidebarDeskPhotoUrl: null,
  role: "admin",
  googleEmail: null,
  isActive: true,
  lastLoginAt: new Date().toISOString(),
  organizationId: DEMO_ORG_ID,
  organizationName: "Meridian Group",
  organizationType: "demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

export function isDemoUser(userId: string): boolean {
  return userId === DEMO_USER_ID
}

export function isDemoOrg(orgId: string): boolean {
  return orgId === DEMO_ORG_ID
}
