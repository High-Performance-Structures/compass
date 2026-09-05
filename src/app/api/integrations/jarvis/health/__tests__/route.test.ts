import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  readBoundedBody: vi.fn(),
  verifyJarvisRequest: vi.fn(),
  recordFeedbackServiceHealth: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  getJarvisEnvValue: mocks.getJarvisEnvValue,
  readBoundedBody: mocks.readBoundedBody,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))
vi.mock("@/lib/jarvis/feedback-maintenance", () => ({
  recordFeedbackServiceHealth: mocks.recordFeedbackServiceHealth,
}))

import { POST } from "../route"

describe("POST /api/integrations/jarvis/health", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret" } })
    mocks.getDb.mockReturnValue({})
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.getJarvisEnvValue.mockReturnValue("org-1")
    mocks.readBoundedBody.mockImplementation(async (request: Request) => ({
      success: true,
      rawBody: await request.text(),
    }))
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
    mocks.recordFeedbackServiceHealth.mockResolvedValue(undefined)
  })

  it("accepts the durable delivery consumer heartbeat", async () => {
    const response = await POST(new Request("https://compass.example/api/integrations/jarvis/health", {
      method: "POST",
      body: JSON.stringify({
        serviceName: "jarvis-feedback-delivery-consumer",
        status: "healthy",
        metadata: { claimedEventCount: 2, completedCount: 2, failedCount: 0 },
      }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.recordFeedbackServiceHealth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serviceName: "jarvis-feedback-delivery-consumer",
      status: "healthy",
    }))
  })
})
