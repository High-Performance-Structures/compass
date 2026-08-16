import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  getActiveStaffBoardOrganization: vi.fn(),
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock("@/lib/staff-board", () => ({
  getActiveStaffBoardOrganization: deps.getActiveStaffBoardOrganization,
}))
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  requireAuth: deps.requireAuth,
}))
vi.mock("@/lib/db", () => ({ getCloudflareContext: deps.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: deps.getDb }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const { getNotificationCenter } = await import("@/app/actions/notifications")

const user = {
  id: "staff-1",
  email: "staff@example.com",
  firstName: "Staff",
  lastName: "User",
  displayName: "Staff User",
  avatarUrl: null,
  dashboardDeskPhotoUrl: null,
  sidebarDeskPhotoUrl: null,
  role: "office",
  organizationId: "org-1",
  organizationType: "internal",
  isActive: true,
} as const

describe("notification center Staff Board authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deps.requireAuth.mockResolvedValue(user)
    deps.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    deps.getActiveStaffBoardOrganization.mockResolvedValue(null)
    deps.getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
    })
  })

  it("revalidates the current user before reading notification rows", async () => {
    const result = await getNotificationCenter()

    expect(result.success).toBe(true)
    expect(deps.getActiveStaffBoardOrganization).toHaveBeenCalledWith(user)
  })
})
