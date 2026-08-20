import { beforeEach, describe, expect, it, vi } from "vitest"

const workosMocks = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  sendInvitation: vi.fn(),
}))

vi.mock("@workos-inc/node", () => ({
  WorkOS: class MockWorkOS {
    readonly userManagement = workosMocks
  },
}))

import { sendOrResendWorkOSInvitation } from "../workos-invitations"

describe("sendOrResendWorkOSInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("resends a pending invitation", async () => {
    workosMocks.listInvitations.mockResolvedValue({
      data: [{ id: "invitation_pending", state: "pending" }],
    })

    const result = await sendOrResendWorkOSInvitation({
      apiKey: "test-key",
      email: "staff@example.com",
    })

    expect(result).toEqual({ success: true })
    expect(workosMocks.resendInvitation).toHaveBeenCalledWith(
      "invitation_pending"
    )
    expect(workosMocks.sendInvitation).not.toHaveBeenCalled()
  })

  it("creates a replacement invitation after expiration", async () => {
    workosMocks.listInvitations.mockResolvedValue({
      data: [{ id: "invitation_expired", state: "expired" }],
    })

    const result = await sendOrResendWorkOSInvitation({
      apiKey: "test-key",
      email: "staff@example.com",
    })

    expect(result).toEqual({ success: true })
    expect(workosMocks.sendInvitation).toHaveBeenCalledWith({
      email: "staff@example.com",
    })
    expect(workosMocks.resendInvitation).not.toHaveBeenCalled()
  })

  it("does not duplicate an accepted invitation", async () => {
    workosMocks.listInvitations.mockResolvedValue({
      data: [{ id: "invitation_accepted", state: "accepted" }],
    })

    const result = await sendOrResendWorkOSInvitation({
      apiKey: "test-key",
      email: "staff@example.com",
    })

    expect(result).toEqual({
      success: false,
      error:
        "Invitation was already accepted. Ask the user to sign in to activate their Compass account.",
    })
    expect(workosMocks.sendInvitation).not.toHaveBeenCalled()
    expect(workosMocks.resendInvitation).not.toHaveBeenCalled()
  })
})
