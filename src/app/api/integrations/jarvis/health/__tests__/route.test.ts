import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  readBoundedBody: vi.fn(),
  recordFeedbackServiceHealth: vi.fn(),
  verifyJarvisRequest: vi.fn(),
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

function configureRequest(body: string): Request {
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
  mocks.getJarvisEnvValue.mockReturnValue("org-1")
  mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody: body })
  mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  mocks.getDb.mockReturnValue({})
  mocks.recordFeedbackServiceHealth.mockResolvedValue(undefined)
  return new Request("https://compass.example/api/integrations/jarvis/health", {
    method: "POST",
    body,
  })
}

describe("POST /api/integrations/jarvis/health", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("accepts the bounded lifecycle executor heartbeat", async () => {
    const response = await POST(configureRequest(JSON.stringify({
      serviceName: "jarvis-feedback-lifecycle-executor",
      status: "healthy",
    })))

    expect(response.status).toBe(200)
    expect(mocks.recordFeedbackServiceHealth).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        serviceName: "jarvis-feedback-lifecycle-executor",
        organizationId: "org-1",
        status: "healthy",
      }),
    )
  })

  it("rejects an unregistered service name before persistence", async () => {
    const response = await POST(configureRequest(JSON.stringify({
      serviceName: "arbitrary-worker",
      status: "healthy",
    })))

    expect(response.status).toBe(400)
    expect(mocks.recordFeedbackServiceHealth).not.toHaveBeenCalled()
  })
})
