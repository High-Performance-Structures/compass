import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createSystemNotificationEvent: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  insertJarvisBridgeEvents: vi.fn(),
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
vi.mock("@/lib/domain/feedback/store", () => ({
  insertJarvisBridgeEvents: mocks.insertJarvisBridgeEvents,
}))
vi.mock("@/lib/notifications/events", () => ({
  createSystemNotificationEvent: mocks.createSystemNotificationEvent,
}))

import { POST } from "../route"

const featureRequest = {
  id: "feedback-1",
  kind: "feature",
  status: "triaged",
  title: "Add a combined schedule calendar",
}

const members = [
  { userId: "admin-1", email: "admin@example.com", role: "admin" },
  { userId: "second-1", email: "second@example.com", role: "secondary_admin" },
  { userId: "pm-1", email: "pm@example.com", role: "project_manager" },
]

function configureDb(item: unknown, duplicate: unknown = null) {
  const get = vi.fn().mockResolvedValueOnce(duplicate).mockResolvedValueOnce(item)
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    get,
    then: (resolve: (value: unknown) => unknown) => resolve(members),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(chain) })
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://compass.example/api/integrations/jarvis/feedback/feedback-1/review-request", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "feedback-1" }) },
  )
}

describe("POST /api/integrations/jarvis/feedback/:id/review-request", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getJarvisEnvValue.mockImplementation((_env: unknown, key: string) =>
      key === "JARVIS_BRIDGE_ORGANIZATION_ID" ? "org-1" : null,
    )
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.readBoundedBody.mockImplementation(async (request: Request) => ({
      success: true,
      rawBody: await request.text(),
    }))
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
    mocks.insertJarvisBridgeEvents.mockReturnValue({ onConflictDoNothing: vi.fn() })
  })

  it("notifies only Feedback Desk administrators and records the request", async () => {
    configureDb(featureRequest)
    const response = await post({ idempotencyKey: "run-1", summary: "Looks partly built." })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, notifiedUserCount: 2 })
    expect(mocks.createSystemNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "feedback.review_requested",
      sourceId: "feedback-1",
      body: "Looks partly built.",
      href: "/dashboard/requests/manage",
      recipients: [
        { userId: "admin-1", email: "admin@example.com" },
        { userId: "second-1", email: "second@example.com" },
      ],
    }))
    expect(mocks.insertJarvisBridgeEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: "feedback.review_requested",
      idempotencyKey: "feedback-review:feedback-1:run-1",
      feedbackDeskItemId: "feedback-1",
    }))
  })

  it("does not notify twice for the same idempotency key", async () => {
    configureDb(featureRequest, { id: "event-1" })
    const response = await post({ idempotencyKey: "run-1", summary: "Again." })

    expect(await response.json()).toEqual({ success: true, duplicate: true })
    expect(mocks.createSystemNotificationEvent).not.toHaveBeenCalled()
  })

  it("refuses a request that is already resolved", async () => {
    configureDb({ ...featureRequest, status: "closed" })
    const response = await post({ idempotencyKey: "run-2", summary: "Closed already." })

    expect(response.status).toBe(409)
    expect(mocks.createSystemNotificationEvent).not.toHaveBeenCalled()
  })

  it("rejects an unsigned request", async () => {
    configureDb(featureRequest)
    mocks.verifyJarvisRequest.mockResolvedValue({ success: false, error: "Bad signature" })
    const response = await post({ idempotencyKey: "run-3", summary: "x" })

    expect(response.status).toBe(401)
    expect(mocks.createSystemNotificationEvent).not.toHaveBeenCalled()
  })
})
