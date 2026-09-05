import { describe, expect, it, vi } from "vitest"

const mocks = {
  getCurrentUser: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}))

const inactiveUser = {
  id: "former-user",
  email: "former@example.com",
  role: "project_manager",
  isActive: false,
  organizationId: "org-1",
  organizationType: "internal",
}

describe("conversation action inactive-user boundary", () => {
  it("denies inactive users before listing or loading channels", async () => {
    const { getChannel, listChannels } = await import("../conversations")
    mocks.getCurrentUser.mockResolvedValue(inactiveUser)

    await expect(listChannels()).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    })
    await expect(getChannel("channel-1")).resolves.toEqual({
      success: false,
      error: "Unauthorized",
    })
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
  })
})
