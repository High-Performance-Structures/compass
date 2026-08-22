import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  readBoundedBody: vi.fn(),
  verifyJarvisRequest: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  readBoundedBody: mocks.readBoundedBody,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))

import { GET } from "../route"

describe("GET /api/integrations/jarvis/events/:id/delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret" },
    })
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.verifyJarvisRequest.mockResolvedValue({
      success: false,
      error: "Missing bridge signature",
    })
    mocks.readBoundedBody.mockResolvedValue({
      success: false,
      error: "Request body is too large",
    })
  })

  it("authenticates before inspecting a malformed body", async () => {
    const response = await GET(
      new Request(
        "https://compass.example/api/integrations/jarvis/events/event-1/delivery",
        { method: "GET" },
      ),
      { params: Promise.resolve({ id: "event-1" }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Missing bridge signature",
    })
    expect(mocks.readBoundedBody).not.toHaveBeenCalled()
    expect(mocks.verifyJarvisRequest).toHaveBeenCalledWith(
      expect.any(Request),
      ["secret"],
      "",
    )
    expect(mocks.getDb).not.toHaveBeenCalled()
  })
})
