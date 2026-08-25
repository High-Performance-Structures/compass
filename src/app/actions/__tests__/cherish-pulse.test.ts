import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canUseExecutiveAdmin: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permissions", () => ({
  canUseExecutiveAdmin: mocks.canUseExecutiveAdmin,
  canUseFieldDesk: vi.fn(() => true),
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))

import { reviewCherishPulseResponse } from "@/app/actions/cherish-pulse"

describe("reviewCherishPulseResponse", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "executive-1",
      organizationId: "org-1",
      email: "executive@example.com",
    })
    mocks.canUseExecutiveAdmin.mockReturnValue(true)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.revalidatePath.mockReset()
  })

  it("archives an existing approved recognition and invalidates every stream", async () => {
    const selectChain = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    selectChain.get.mockResolvedValue({ id: "recognition-1" })

    const updateChain = { set: vi.fn(), where: vi.fn(), run: vi.fn() }
    updateChain.set.mockReturnValue(updateChain)
    updateChain.where.mockReturnValue(updateChain)
    updateChain.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    })

    const result = await reviewCherishPulseResponse({
      id: "recognition-1",
      decision: "archive",
    })

    expect(result).toEqual({
      success: true,
      data: { id: "recognition-1", reviewStatus: "archived" },
    })
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewStatus: "archived",
        publishedAt: null,
      }),
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/field")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/dashboard/executive-admin/cherish",
    )
  })
})
