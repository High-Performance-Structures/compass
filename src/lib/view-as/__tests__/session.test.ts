import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth"
import type { ViewAsSettings } from "@/lib/feature-settings/view-as-settings"

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, extraStaffUserIds: [] } as ViewAsSettings,
  ended: false,
  targetRole: "owner",
  inCompany: true,
  activeOrg: { orgId: "org-1", orgName: "Builder", orgType: "internal", memberRole: "owner" } as
    | { orgId: string; orgName: string; orgType: string; memberRole: string }
    | null,
}))

vi.mock("@/lib/feature-settings/server", () => ({ readFeatureSettings: vi.fn(async () => mocks.settings) }))
vi.mock("@/lib/view-as/audit", () => ({ isViewAsSessionEnded: vi.fn(async () => mocks.ended) }))
vi.mock("@/lib/domain/identity/view-as-people", () => ({
  isPersonOfCompany: vi.fn(async () => mocks.inCompany),
  viewAsIdentity: vi.fn(async () => ({
    account: {
      id: "owner-1",
      email: "olive@example.com",
      firstName: "Olive",
      lastName: "Owner",
      displayName: "Olive Owner",
      phone: null,
      address: null,
      avatarUrl: null,
      dashboardDeskPhotoUrl: null,
      sidebarDeskPhotoUrl: null,
      role: "guest",
      googleEmail: null,
      isActive: true,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    session: { role: mocks.targetRole, activeOrg: mocks.activeOrg },
  })),
}))

const { resolveViewAs } = await import("@/lib/view-as/session")
const { signViewAsToken } = await import("@/lib/view-as/token")

const SECRET = "a-test-secret-that-is-long-enough"

const admin: AuthUser = {
  id: "admin-1",
  email: "admin@example.com",
  firstName: "Ada",
  lastName: "Admin",
  displayName: "Ada Admin",
  avatarUrl: null,
  role: "admin",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Builder",
  organizationType: "internal",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

async function token(overrides: Partial<{ adminId: string; orgId: string; exp: number }> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signViewAsToken({ v: 1, sid: "s1", adminId: "admin-1", targetId: "owner-1", orgId: "org-1", targetEmails: ["olive@example.com"], iat: now, exp: now + 600, ...overrides }, SECRET)
}

async function resolve(input: Partial<{ token: string; admin: AuthUser | null; developerModeEnabled: boolean }> = {}) {
  return resolveViewAs({
    token: input.token ?? (await token()),
    secret: SECRET,
    admin: input.admin === undefined ? admin : input.admin,
    db: {} as never,
    developerModeEnabled: input.developerModeEnabled ?? true,
  })
}

describe("resolveViewAs (rechecked on every request)", () => {
  beforeEach(() => {
    mocks.settings = { enabled: true, extraStaffUserIds: [] }
    mocks.ended = false
    mocks.targetRole = "owner"
    mocks.inCompany = true
    mocks.activeOrg = { orgId: "org-1", orgName: "Builder", orgType: "internal", memberRole: "owner" }
  })

  it("substitutes the viewed person's own identity and role", async () => {
    const result = await resolve()
    expect(result.kind).toBe("active")
    if (result.kind !== "active") return
    expect(result.target).toMatchObject({ id: "owner-1", role: "owner", organizationId: "org-1", viewAsCompanyId: "org-1" })
    expect(result.admin.id).toBe("admin-1")
  })

  it("ends when developer mode is turned off", async () => {
    expect((await resolve({ developerModeEnabled: false })).kind).toBe("invalid")
  })

  it("ends when the company turns the setting off", async () => {
    mocks.settings = { enabled: false, extraStaffUserIds: [] }
    expect((await resolve()).kind).toBe("invalid")
  })

  it("ends when the admin is no longer an admin", async () => {
    expect((await resolve({ admin: { ...admin, role: "project_manager" } })).kind).toBe("invalid")
  })

  it("refuses a cookie carried into another person's sign-in or company", async () => {
    expect((await resolve({ admin: { ...admin, id: "admin-2" } })).kind).toBe("invalid")
    expect((await resolve({ token: await token({ orgId: "org-2" }) })).kind).toBe("invalid")
    expect((await resolve({ admin: null })).kind).toBe("invalid")
  })

  it("refuses a session already ended (a copied cookie replayed after Exit)", async () => {
    mocks.ended = true
    expect(await resolve()).toMatchObject({ kind: "invalid", code: "revoked" })
  })

  it("keeps the privilege ceiling on every request", async () => {
    mocks.targetRole = "admin"
    expect(await resolve({ admin: { ...admin, role: "secondary_admin" } })).toMatchObject({ kind: "invalid", code: "privilege" })
    expect((await resolve()).kind).toBe("active")
  })

  it("says why a session is over, for the end entry", async () => {
    expect(await resolve({ developerModeEnabled: false })).toMatchObject({ code: "developer_mode_off" })
    mocks.settings = { enabled: false, extraStaffUserIds: [] }
    expect(await resolve()).toMatchObject({ code: "setting_off" })
    mocks.settings = { enabled: true, extraStaffUserIds: [] }
    expect(await resolve({ admin: { ...admin, role: "project_manager" } })).toMatchObject({ code: "not_allowed" })
    mocks.inCompany = false
    expect(await resolve()).toMatchObject({ code: "person_unavailable" })
    expect(await resolve({ token: await token({ exp: 1 }) })).toMatchObject({ code: "expired" })
    expect(await resolve({ admin: { ...admin, id: "admin-2" } })).toMatchObject({ code: "other_sign_in" })
  })

  it("refuses expired and forged tokens", async () => {
    expect((await resolve({ token: await token({ exp: 1 }) })).kind).toBe("invalid")
    expect((await resolve({ token: "owner-1" })).kind).toBe("invalid")
  })

  it("refuses a person who left the company or opens in another one", async () => {
    mocks.inCompany = false
    expect((await resolve()).kind).toBe("invalid")
    mocks.inCompany = true
    mocks.activeOrg = { orgId: "org-2", orgName: "Other", orgType: "internal", memberRole: "admin" }
    expect((await resolve()).kind).toBe("invalid")
  })
})
