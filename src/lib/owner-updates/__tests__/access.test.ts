import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = {
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}))

const { assertOwnerUpdateReadAccess } = await import("@/lib/owner-updates/access")

type TestUser = Parameters<typeof assertOwnerUpdateReadAccess>[0]

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user-1",
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    displayName: "Test User",
    avatarUrl: null,
    dashboardDeskPhotoUrl: null,
    sidebarDeskPhotoUrl: null,
    role: "client",
    googleEmail: null,
    isActive: true,
    lastLoginAt: null,
    organizationId: "org-client",
    organizationName: "Client Org",
    organizationType: "client",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function dbForOrganization(row: { readonly id: string; readonly type: string; readonly isActive: boolean }) {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (row.isActive ? [row] : [])),
        })),
      })),
    })),
  }
  mocks.getDb.mockReturnValue(db)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
  return db
}

describe("owner-update read access", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects an inactive account before opening the database", async () => {
    await expect(
      assertOwnerUpdateReadAccess(user({ isActive: false }))
    ).rejects.toThrow("active account")
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("rejects an inactive current organization before returning a database", async () => {
    dbForOrganization({ id: "org-client", type: "client", isActive: false })

    await expect(assertOwnerUpdateReadAccess(user())).rejects.toThrow(
      "active organization"
    )
  })

  it("accepts the current active organization and returns its database", async () => {
    const db = dbForOrganization({
      id: "org-client",
      type: "client",
      isActive: true,
    })

    await expect(assertOwnerUpdateReadAccess(user())).resolves.toBe(db)
  })
})
