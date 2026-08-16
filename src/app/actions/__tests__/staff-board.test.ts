import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getDb: vi.fn(), getCloudflareContext: vi.fn(),
  getActiveStaffBoardOrganization: vi.fn(), getStaffBoardRecipients: vi.fn(),
  validateStaffBoardPost: vi.fn(), isDemoUser: vi.fn(), revalidatePath: vi.fn(),
  requirePermission: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: deps.getCurrentUser }))
vi.mock("@/db", () => ({ getDb: deps.getDb }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: deps.getCloudflareContext }))
vi.mock("@/lib/staff-board", () => ({ getActiveStaffBoardOrganization: deps.getActiveStaffBoardOrganization, getStaffBoardRecipients: deps.getStaffBoardRecipients, validateStaffBoardPost: deps.validateStaffBoardPost }))
vi.mock("@/lib/demo", () => ({ isDemoUser: deps.isDemoUser }))
vi.mock("@/lib/permissions", () => ({ requirePermission: deps.requirePermission }))
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidatePath }))

const { createStaffBoardPost, toggleStaffBoardPostPin } = await import("@/app/actions/staff-board")

const internalUser = {
  id: "staff-1", email: "staff@example.com", firstName: "Staff", lastName: "One", displayName: "Staff One",
  avatarUrl: null, role: "office", googleEmail: null, isActive: true, lastLoginAt: null,
  organizationId: "org-1", organizationName: "HPS", organizationType: "internal",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
} as const

function makeDb() {
  const insert = vi.fn(() => ({ values: vi.fn(() => ({ statement: "insert" })) }))
  const updateReturning = vi.fn().mockResolvedValue([{ id: "post-1" }])
  const where = vi.fn(() => ({ returning: updateReturning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  return { insert, update, select: vi.fn(), batch: vi.fn().mockResolvedValue([]), updateReturning }
}

describe("staff board action authorization and persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deps.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    deps.isDemoUser.mockReturnValue(false)
    deps.validateStaffBoardPost.mockReturnValue({ success: true, data: { title: "Update", body: "Message" } })
  })

  it("denies an external caller before opening a database context", async () => {
    deps.getCurrentUser.mockResolvedValue({ ...internalUser, role: "client", organizationType: "client" })
    deps.getActiveStaffBoardOrganization.mockResolvedValue(null)
    const db = makeDb(); deps.getDb.mockReturnValue(db)
    await expect(createStaffBoardPost({ title: "Update", body: "Message" })).resolves.toEqual({ success: false, error: "Staff access required" })
    expect(deps.getActiveStaffBoardOrganization).toHaveBeenCalledTimes(1)
    expect(deps.getDb).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled()
  })

  it("batches the post and in-app notification rows as one persistence unit", async () => {
    deps.getCurrentUser.mockResolvedValue(internalUser)
    deps.getActiveStaffBoardOrganization.mockResolvedValue("org-1")
    deps.getStaffBoardRecipients.mockResolvedValue([{ userId: "staff-2", email: "two@example.com" }])
    const db = makeDb(); deps.getDb.mockReturnValue(db)
    await expect(createStaffBoardPost({ title: "Update", body: "Message" })).resolves.toEqual({ success: true })
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.batch.mock.calls[0]?.[0]).toHaveLength(3); expect(db.insert).toHaveBeenCalledTimes(3)
  })

  it("pins with one organization-scoped atomic update and no read-before-write", async () => {
    deps.getCurrentUser.mockResolvedValue(internalUser); deps.getActiveStaffBoardOrganization.mockResolvedValue("org-1")
    const db = makeDb(); deps.getDb.mockReturnValue(db)
    await expect(toggleStaffBoardPostPin("post-1")).resolves.toEqual({ success: true })
    expect(db.select).not.toHaveBeenCalled(); expect(db.update).toHaveBeenCalledTimes(1); expect(db.updateReturning).toHaveBeenCalledTimes(1)
  })
})
