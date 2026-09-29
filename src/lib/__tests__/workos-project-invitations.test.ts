import { beforeEach, describe, expect, it, vi } from "vitest"

const workosMocks = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  sendInvitation: vi.fn(),
}))

vi.mock("@workos-inc/node", () => ({ WorkOS: class MockWorkOS { readonly userManagement = workosMocks } }))

import { sendOrResendProjectWorkOSInvitation } from "../workos-invitations"

const refreshed = { id: "invitation_existing", expiresAt: "2026-10-13T00:00:00Z", acceptInvitationUrl: "https://example.test/accept/fresh" }

describe("project WorkOS invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workosMocks.listInvitations.mockResolvedValue({ data: [] })
    workosMocks.resendInvitation.mockResolvedValue(refreshed)
    workosMocks.sendInvitation.mockResolvedValue(refreshed)
  })

  it("resends an existing pending account invitation instead of duplicating it", async () => {
    workosMocks.listInvitations.mockResolvedValue({ data: [{ id: "invitation_existing", email: "person@example.com", organizationId: null, state: "pending" }] })
    const result = await sendOrResendProjectWorkOSInvitation({ apiKey: "test-key", email: "person@example.com" })
    expect(workosMocks.resendInvitation).toHaveBeenCalledWith("invitation_existing")
    expect(workosMocks.sendInvitation).not.toHaveBeenCalled()
    expect(result).toEqual(refreshed)
  })

  it("creates a fresh invitation when only expired invitations exist", async () => {
    workosMocks.listInvitations.mockResolvedValue({ data: [{ id: "old", email: "person@example.com", organizationId: null, state: "expired" }] })
    await sendOrResendProjectWorkOSInvitation({ apiKey: "test-key", email: "person@example.com" })
    expect(workosMocks.sendInvitation).toHaveBeenCalledWith({ email: "person@example.com", expiresInDays: 14 })
  })

  it("does not reuse another organization's invitation", async () => {
    workosMocks.listInvitations.mockResolvedValue({ data: [{ id: "other-org", email: "person@example.com", organizationId: "org_other", state: "pending" }] })
    await sendOrResendProjectWorkOSInvitation({ apiKey: "test-key", email: "person@example.com" })
    expect(workosMocks.resendInvitation).not.toHaveBeenCalled()
    expect(workosMocks.sendInvitation).toHaveBeenCalledOnce()
  })
})
