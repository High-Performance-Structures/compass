import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getWorkOS: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
  updateUser: vi.fn(),
  withAuth: vi.fn(),
}))

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: mocks.getWorkOS,
  signOut: vi.fn(),
  withAuth: mocks.withAuth,
}))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

import { updateProfile } from "@/app/actions/profile"

describe("updateProfile WorkOS identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({
      id: "legacy-local-placeholder",
      email: "stanley@example.com",
    })
    mocks.withAuth.mockResolvedValue({
      user: {
        id: "user_workos_stanley",
        email: "stanley@example.com",
      },
    })
    mocks.getWorkOS.mockReturnValue({
      userManagement: { updateUser: mocks.updateUser },
    })
    mocks.updateUser.mockResolvedValue({})
    mocks.getCloudflareContext.mockResolvedValue({ env: {} })
  })

  it("updates the authenticated WorkOS identity while preserving the local ID", async () => {
    const result = await updateProfile({
      firstName: "Stanley",
      lastName: "Platt",
      email: "stanley@example.com",
      phone: "",
      address: "",
    })

    expect(result).toEqual({
      success: true,
      data: {
        emailVerificationRequired: false,
        verificationEmailSent: true,
      },
    })
    expect(mocks.updateUser).toHaveBeenCalledWith({
      userId: "user_workos_stanley",
      firstName: "Stanley",
      lastName: "Platt",
    })
  })
})
