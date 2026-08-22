import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  readBoundedBody: vi.fn(),
  verifyJarvisRequest: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  getJarvisEnvValue: mocks.getJarvisEnvValue,
  readBoundedBody: mocks.readBoundedBody,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))

import { POST } from "../route"

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000"

function body(claimToken?: string, idempotencyKey = "reply-event-1"): string {
  return JSON.stringify({
    eventId: EVENT_ID,
    ...(claimToken === undefined ? {} : { claimToken }),
    idempotencyKey,
    content: "Development has started.",
  })
}

function database(
  lockedSource: Readonly<Record<string, unknown>> | null = null,
  selectResults: readonly unknown[] = [],
) {
  const selectGet = vi.fn()
  for (const result of selectResults) {
    selectGet.mockResolvedValueOnce(result)
  }
  selectGet.mockResolvedValue(null)
  const selectWhere = vi.fn(() => ({ get: selectGet }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const mutationGet = vi.fn().mockResolvedValue(lockedSource)
  const returning = vi.fn(() => ({ get: mutationGet }))
  const mutationWhere = vi.fn(() => ({ returning }))
  const set = vi.fn((value: unknown) => ({ value, where: mutationWhere }))
  const update = vi.fn(() => ({ set }))

  const insertedValues: unknown[] = []
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn((value: unknown) => {
    insertedValues.push(value)
    return { onConflictDoNothing }
  })
  const insert = vi.fn(() => ({ values }))

  return {
    db: { select, update, insert },
    select,
    update,
    set,
    insert,
    insertedValues,
  }
}

describe("POST /api/integrations/jarvis/replies", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getJarvisBridgeSecrets.mockReturnValue({ primary: "secret" })
    mocks.getJarvisEnvValue.mockReturnValue("jarvis-service-user")
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  })

  it("requires a claim token before database access", async () => {
    const state = database()
    mocks.getDb.mockReturnValue(state.db)
    const rawBody = body()
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    const response = await POST(new Request("https://compass.example/api/integrations/jarvis/replies", {
      method: "POST",
      body: rawBody,
    }))

    expect(response.status).toBe(400)
    expect(state.select).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it("rejects a stale claim before reply targets or messages are read", async () => {
    const state = database()
    mocks.getDb.mockReturnValue(state.db)
    const rawBody = body("stale-claim")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    const response = await POST(new Request("https://compass.example/api/integrations/jarvis/replies", {
      method: "POST",
      body: rawBody,
    }))

    expect(response.status).toBe(409)
    expect(state.update).toHaveBeenCalledOnce()
    expect(state.select).not.toHaveBeenCalled()
    expect(state.insert).not.toHaveBeenCalled()
  })

  it("returns the refreshed claim without completing the source event", async () => {
    const state = database(
      {
        id: EVENT_ID,
        eventType: "assistance.requested",
        source: "compass-conversation",
        idempotencyKey: "source-event-1",
        payload: JSON.stringify({
          compass: {
            organizationId: "organization-1",
            channelId: "channel-1",
            messageId: "message-1",
          },
        }),
        feedbackDeskItemId: null,
      },
      [
        { organizationId: "organization-1" },
        { id: "jarvis-service-user", isActive: true },
        { id: "organization-member-1" },
        { id: "channel-member-1" },
        null,
      ],
    )
    mocks.getDb.mockReturnValue(state.db)
    const rawBody = body("active-claim")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    const response = await POST(new Request("https://compass.example/api/integrations/jarvis/replies", {
      method: "POST",
      body: rawBody,
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      claimToken: expect.any(String),
    }))
    expect(state.update).toHaveBeenCalledTimes(4)
    expect(state.insert).toHaveBeenCalledTimes(2)
    const completedSourceMutation = state.set.mock.calls.some((call) => {
      const value: unknown = call[0]
      return typeof value === "object" && value !== null &&
        Reflect.get(value, "status") === "completed"
    })
    expect(completedSourceMutation).toBe(false)
  })

  it("derives reply identity from the source event rather than caller retry keys", async () => {
    function successfulState() {
      return database(
        {
          id: EVENT_ID,
          eventType: "assistance.requested",
          source: "compass-conversation",
          idempotencyKey: "source-event-1",
          payload: JSON.stringify({
            compass: {
              organizationId: "organization-1",
              channelId: "channel-1",
              messageId: "message-1",
            },
          }),
          feedbackDeskItemId: null,
        },
        [
          { organizationId: "organization-1" },
          { id: "jarvis-service-user", isActive: true },
          { id: "organization-member-1" },
          { id: "channel-member-1" },
          null,
        ],
      )
    }

    const first = successfulState()
    mocks.getDb.mockReturnValue(first.db)
    const firstBody = body("active-claim", "retry-key-a")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody: firstBody })
    const firstResponse = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/replies",
      { method: "POST", body: firstBody },
    ))

    const second = successfulState()
    mocks.getDb.mockReturnValue(second.db)
    const secondBody = body("active-claim", "retry-key-b")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody: secondBody })
    const secondResponse = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/replies",
      { method: "POST", body: secondBody },
    ))

    const firstMessage = first.insertedValues.find((value) =>
      typeof value === "object" && value !== null && Reflect.has(value, "content"))
    const secondMessage = second.insertedValues.find((value) =>
      typeof value === "object" && value !== null && Reflect.has(value, "content"))

    if (
      typeof firstMessage !== "object" || firstMessage === null ||
      typeof secondMessage !== "object" || secondMessage === null
    ) {
      throw new Error("Expected both requests to construct a reply message")
    }

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(Reflect.get(firstMessage, "id")).toBe(Reflect.get(secondMessage, "id"))
  })

  it("reserves the source event before persisting reply side effects", async () => {
    const state = database(
      {
        id: EVENT_ID,
        eventType: "assistance.requested",
        source: "compass-conversation",
        idempotencyKey: "source-event-1",
        payload: JSON.stringify({
          compass: {
            organizationId: "organization-1",
            channelId: "channel-1",
            messageId: "message-1",
          },
        }),
        feedbackDeskItemId: null,
      },
      [
        { organizationId: "organization-1" },
        { id: "jarvis-service-user", isActive: true },
        { id: "organization-member-1" },
        { id: "channel-member-1" },
        null,
      ],
    )
    mocks.getDb.mockReturnValue(state.db)
    const rawBody = body("active-claim")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    const response = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/replies",
      { method: "POST", body: rawBody },
    ))

    expect(response.status).toBe(200)
    expect(state.set).toHaveBeenCalledWith(expect.objectContaining({
      result: JSON.stringify({ reply: "reserved" }),
    }))
  })
})
