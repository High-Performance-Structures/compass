import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
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
vi.mock("@/lib/jarvis/visual-context", () => ({
  jarvisPayloadAfterCompletion: vi.fn((payload: string) => payload),
}))

import { POST } from "../route"

const event = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  claimToken: "claim-1",
  eventType: "feedback.delivery_requested",
  payload: JSON.stringify({
    schemaVersion: 1,
    feedbackDeskItemId: "feedback-1",
    reference: "CFD-feedback-1",
    kind: "bug",
  }),
  feedbackDeskItemId: "feedback-1",
}

const completeItem = {
  id: "feedback-1",
  deliveryGraphId: "graph-1",
  deliveryGraphStatus: "created",
  deliveryGraphImplementationTaskId: "implementation-1",
  deliveryGraphReviewTaskId: "review-1",
  deliveryGraphReleaseTaskId: "release-1",
}

function configureDb(item: Readonly<Record<string, unknown>> | null) {
  const get = vi.fn()
    .mockResolvedValueOnce(event)
    .mockResolvedValueOnce(item)
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    get,
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)

  const where = vi.fn()
  const getUpdated = vi.fn().mockResolvedValue({ id: event.id })
  const returning = vi.fn().mockReturnValue({ get: getUpdated })
  where.mockReturnValue({ returning, get: getUpdated })
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  mocks.getDb.mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update,
  })
  return { update, set, where, getUpdated }
}

async function acknowledge() {
  return POST(
    new Request("https://compass.example/api/integrations/jarvis/events/123e4567-e89b-12d3-a456-426614174000/ack", {
      method: "POST",
      body: JSON.stringify({ status: "completed", claimToken: "claim-1" }),
    }),
    { params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }) },
  )
}

describe("POST /api/integrations/jarvis/events/:id/ack", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret" },
    })
    mocks.getJarvisEnvValue.mockImplementation((_env: unknown, key: string) =>
      key === "JARVIS_BRIDGE_SECRET" ? "secret" : null,
    )
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.readBoundedBody.mockImplementation(async (request: Request) => ({
      success: true,
      rawBody: await request.text(),
    }))
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  })

  it("retains an incompletely attached delivery event for retry", async () => {
    const db = configureDb({
      ...completeItem,
      deliveryGraphReleaseTaskId: null,
    })

    const response = await acknowledge()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      retryable: true,
    })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      completedAt: null,
      claimToken: null,
      claimedAt: null,
    }))
  })

  it("completes the event only after all graph IDs are durable", async () => {
    const db = configureDb(completeItem)

    const response = await acknowledge()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
    }))
  })

  it("rejects an acknowledgement after another claimer fenced the event", async () => {
    const db = configureDb(completeItem)
    db.getUpdated.mockResolvedValue(null)

    const response = await acknowledge()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
  })
})
