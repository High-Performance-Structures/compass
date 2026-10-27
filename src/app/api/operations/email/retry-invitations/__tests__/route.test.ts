import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "../route"
const mocks = vi.hoisted(() => ({ secrets: vi.fn(), verify: vi.fn(), retry: vi.fn() }))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/lib/jarvis/auth", () => ({ getJarvisBridgeSecrets: mocks.secrets, verifyJarvisRequest: mocks.verify, readBoundedBody: async () => ({ success: true, rawBody: "" }) }))
vi.mock("@/lib/email/invitation-delivery", () => ({ retryInvitationEmails: mocks.retry }))
beforeEach(() => { vi.resetAllMocks(); mocks.secrets.mockReturnValue(["secret"]); mocks.verify.mockResolvedValue({ success: true }); mocks.retry.mockResolvedValue({ processed: 1, needsReview: 0 }) })
const request = (): Request => new Request("https://compass.test/api/operations/email/retry-invitations", { method: "POST" })
describe("invitation retry maintenance authentication", () => {
  it("rejects an unconfigured maintenance secret", async () => {
    mocks.secrets.mockReturnValue(null)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it("rejects a request without a valid signature", async () => {
    mocks.verify.mockResolvedValue({ success: false, error: "Invalid signature" })
    expect((await POST(request())).status).toBe(401)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it("dispatches due emails only after signature verification", async () => {
    const result = await POST(request())
    expect(await result.json()).toEqual({ success: true, processed: 1, needsReview: 0 })
    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })
  it("does not expose provider or database details in maintenance errors", async () => {
    mocks.retry.mockRejectedValue(new Error("private provider details"))
    const result = await POST(request())
    expect(result.status).toBe(500)
    expect(await result.json()).toEqual({ error: "Invitation email recovery failed" })
  })
})
