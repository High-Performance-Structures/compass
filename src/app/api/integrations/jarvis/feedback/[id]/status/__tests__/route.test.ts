import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  applyFeedbackLifecycleUpdate: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  readBoundedBody: vi.fn(),
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
vi.mock("@/lib/jarvis/feedback-status-update", () => ({
  applyFeedbackLifecycleUpdate: mocks.applyFeedbackLifecycleUpdate,
}))

import { POST } from "../route"

const unprovenBug = {
  id: "feedback-1",
  kind: "bug",
  status: "triaged",
  deliveryGraphId: null,
  deliveryGraphStatus: null,
  deliveryGraphImplementationTaskId: null,
  deliveryGraphReviewTaskId: null,
  deliveryGraphReleaseTaskId: null,
  githubDraftPullRequestUrl: null,
}

function configureDb() {
  const get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(unprovenBug)
  const chain = { from: vi.fn(), where: vi.fn(), get }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  mocks.getDb.mockReturnValue({
    select: vi.fn().mockReturnValue(chain),
  })
}

describe("POST /api/integrations/jarvis/feedback/:id/status", () => {
  beforeEach(() => {
    configureDb()
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret", JARVIS_BRIDGE_ORGANIZATION_ID: "org-1" },
    })
    mocks.getJarvisEnvValue.mockImplementation((_env: unknown, key: string) => {
      if (key === "JARVIS_BRIDGE_SECRET") return "secret"
      if (key === "JARVIS_BRIDGE_ORGANIZATION_ID") return "org-1"
      return null
    })
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.readBoundedBody.mockImplementation(async (request: Request) => ({
      success: true,
      rawBody: await request.text(),
    }))
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
    mocks.applyFeedbackLifecycleUpdate.mockReset()
  })

  it("rejects a bug implementation transition without durable evidence", async () => {
    const response = await POST(
      new Request("https://compass.example/api/integrations/jarvis/feedback/feedback-1/status", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "callback-1",
          status: "in_progress",
        }),
      }),
      { params: Promise.resolve({ id: "feedback-1" }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "A bug must have a complete durable delivery graph before implementation starts",
    })
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })

  it("rejects whitespace-only delivery graph IDs before persistence", async () => {
    const response = await POST(
      new Request("https://compass.example/api/integrations/jarvis/feedback/feedback-1/status", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "callback-whitespace-graph",
          status: "triaged",
          deliveryGraph: {
            status: "created",
            graphId: " ",
            implementationTaskId: "\t",
            reviewTaskId: "\n",
            releaseTaskId: " \t",
          },
        }),
      }),
      { params: Promise.resolve({ id: "feedback-1" }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Incomplete feedback delivery graph update",
    })
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })

  it("normalizes failed delivery graph IDs before persistence", async () => {
    mocks.applyFeedbackLifecycleUpdate.mockResolvedValue({
      notifiedUserCount: 0,
      requesterUpdateQueued: false,
    })

    const response = await POST(
      new Request("https://compass.example/api/integrations/jarvis/feedback/feedback-1/status", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "callback-failed-graph",
          status: "triaged",
          deliveryGraph: {
            status: "failed",
            graphId: " graph-failed-1 ",
            implementationTaskId: " \t",
            reviewTaskId: "\nreview-failed-1 \t",
            releaseTaskId: "  ",
            error: " worker failed ",
          },
        }),
      }),
      { params: Promise.resolve({ id: "feedback-1" }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.applyFeedbackLifecycleUpdate).toHaveBeenCalledWith(
      expect.anything(),
      unprovenBug,
      expect.objectContaining({
        deliveryGraph: {
          status: "failed",
          graphId: "graph-failed-1",
          implementationTaskId: null,
          reviewTaskId: "review-failed-1",
          releaseTaskId: null,
          error: "worker failed",
        },
      }),
    )
  })

  it("accepts a complete delivery graph with valid IDs", async () => {
    mocks.applyFeedbackLifecycleUpdate.mockResolvedValue({
      notifiedUserCount: 0,
      requesterUpdateQueued: false,
    })

    const response = await POST(
      new Request("https://compass.example/api/integrations/jarvis/feedback/feedback-1/status", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "callback-valid-graph",
          status: "triaged",
          deliveryGraph: {
            status: "created",
            graphId: "graph-1",
            implementationTaskId: "implementation-1",
            reviewTaskId: "review-1",
            releaseTaskId: "release-1",
          },
        }),
      }),
      { params: Promise.resolve({ id: "feedback-1" }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.applyFeedbackLifecycleUpdate).toHaveBeenCalledWith(
      expect.anything(),
      unprovenBug,
      expect.objectContaining({
        deliveryGraph: {
          status: "created",
          graphId: "graph-1",
          implementationTaskId: "implementation-1",
          reviewTaskId: "review-1",
          releaseTaskId: "release-1",
          error: null,
        },
      }),
    )
  })
})
