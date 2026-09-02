import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

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
  mutationResults: readonly (Readonly<Record<string, unknown>> | null)[] = [],
) {
  const selectGet = vi.fn()
  for (const result of selectResults) {
    selectGet.mockResolvedValueOnce(result)
  }
  selectGet.mockResolvedValue(null)
  const selectWhere = vi.fn(() => ({ get: selectGet }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const mutationGet = vi.fn()
  for (const result of mutationResults) {
    mutationGet.mockResolvedValueOnce(result)
  }
  mutationGet.mockResolvedValue(lockedSource)
  const returning = vi.fn(() => ({ get: mutationGet }))
  const mutationWhere = vi.fn(() => ({ returning }))
  const set = vi.fn((value: unknown) => ({ value, where: mutationWhere }))
  const update = vi.fn(() => ({ set }))

  const insertedValues: unknown[] = []
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const insertSelect = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn((value: unknown) => {
    insertedValues.push(value)
    return { onConflictDoNothing }
  })
  const insert = vi.fn(() => ({ values, select: insertSelect }))
  const batch = vi.fn().mockResolvedValue([])

  return {
    db: { select, update, insert, batch },
    select,
    update,
    set,
    insert,
    batch,
    insertedValues,
  }
}

function sqliteDatabase(
  beforeBatch: (sqlite: InstanceType<typeof Database>) => void,
) {
  const sqlite = new Database(":memory:")
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, is_active INTEGER NOT NULL);
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );
    CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL);
    CREATE TABLE channel_members (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_html TEXT,
      edited_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_reply_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE jarvis_bridge_events (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      direction TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      feedback_desk_item_id TEXT,
      payload TEXT NOT NULL,
      result TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      claim_token TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX jarvis_bridge_idempotency_unique
      ON jarvis_bridge_events (idempotency_key);
  `)
  sqlite.prepare("INSERT INTO users VALUES (?, ?)")
    .run("jarvis-service-user", 1)
  sqlite.prepare("INSERT INTO organization_members VALUES (?, ?, ?)")
    .run("organization-member-1", "organization-1", "jarvis-service-user")
  sqlite.prepare("INSERT INTO channels VALUES (?, ?)")
    .run("channel-1", "organization-1")
  sqlite.prepare("INSERT INTO channel_members VALUES (?, ?, ?)")
    .run("channel-member-1", "channel-1", "jarvis-service-user")
  sqlite.prepare(`
    INSERT INTO messages (
      id, channel_id, user_id, content, is_pinned, reply_count, created_at
    ) VALUES (?, ?, ?, ?, 0, 0, ?)
  `).run(
    "message-1",
    "channel-1",
    "requester-1",
    "Please help",
    "2026-08-22T00:00:00.000Z",
  )
  sqlite.prepare(`
    INSERT INTO jarvis_bridge_events (
      id, organization_id, direction, source, event_type, status,
      idempotency_key, payload, available_at, claim_token, claimed_at,
      created_at, updated_at
    ) VALUES (?, ?, 'outbound', 'compass-conversation', 'assistance.requested',
      'processing', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    EVENT_ID,
    "organization-1",
    "source-event-1",
    JSON.stringify({
      compass: {
        organizationId: "organization-1",
        channelId: "channel-1",
        messageId: "message-1",
      },
    }),
    "2026-08-22T00:00:00.000Z",
    "active-claim",
    "2026-08-22T00:00:00.000Z",
    "2026-08-22T00:00:00.000Z",
    "2026-08-22T00:00:00.000Z",
  )
  const drizzleDb = drizzle(sqlite)
  const batchErrors: string[] = []
  const batch = async (statements: readonly { run: () => unknown }[]) => {
    beforeBatch(sqlite)
    try {
      return sqlite.transaction(
        () => statements.map((statement) => statement.run()),
      )()
    } catch (error) {
      batchErrors.push(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  return {
    sqlite,
    db: {
      select: drizzleDb.select.bind(drizzleDb),
      update: drizzleDb.update.bind(drizzleDb),
      insert: drizzleDb.insert.bind(drizzleDb),
      batch,
    },
    batchErrors,
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
    expect(state.update).toHaveBeenCalledTimes(5)
    expect(state.insert).toHaveBeenCalledTimes(3)
    expect(state.batch).toHaveBeenCalledOnce()
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

  it("rejects reply effects after a reserved claim expires and is replaced", async () => {
    const source = {
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
    }
    const state = database(
      source,
      [
        { organizationId: "organization-1" },
        { id: "jarvis-service-user", isActive: true },
        { id: "organization-member-1" },
        { id: "channel-member-1" },
        null,
      ],
      [source, { id: EVENT_ID }, null],
    )
    mocks.getDb.mockReturnValue(state.db)
    const rawBody = body("active-claim")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    const response = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/replies",
      { method: "POST", body: rawBody },
    ))

    expect(response.status).toBe(409)
    expect(state.update).toHaveBeenCalledTimes(3)
    expect(state.insert).not.toHaveBeenCalled()
  })

  it("rolls back a paused reply batch in SQLite after replacement", async () => {
    let batchCount = 0
    const fixture = sqliteDatabase((sqlite) => {
      batchCount += 1
      if (batchCount === 1) {
        sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET claim_token = 'replacement-claim'
          WHERE id = ?
        `).run(EVENT_ID)
      }
    })
    mocks.getDb.mockReturnValue(fixture.db)
    const rawBody = body("active-claim")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody })

    try {
      const response = await POST(new Request(
        "https://compass.example/api/integrations/jarvis/replies",
        { method: "POST", body: rawBody },
      ))

      expect(response.status).toBe(409)
      expect(fixture.batchErrors).toEqual([
        expect.stringContaining("jarvis_bridge_events.idempotency_key"),
      ])
      expect(fixture.sqlite.prepare(
        "SELECT count(*) AS count FROM messages",
      ).get()).toEqual({ count: 1 })
      expect(fixture.sqlite.prepare(`
        SELECT count(*) AS count FROM jarvis_bridge_events
        WHERE event_type = 'assistance.responded'
      `).get()).toEqual({ count: 0 })
      expect(fixture.sqlite.prepare(`
        SELECT claim_token AS claimToken FROM jarvis_bridge_events
        WHERE id = ?
      `).get(EVENT_ID)).toEqual({ claimToken: "replacement-claim" })

      const replacementBody = body("replacement-claim")
      mocks.readBoundedBody.mockResolvedValue({
        success: true,
        rawBody: replacementBody,
      })
      const replacementResponse = await POST(new Request(
        "https://compass.example/api/integrations/jarvis/replies",
        { method: "POST", body: replacementBody },
      ))

      expect(replacementResponse.status).toBe(200)
      expect(fixture.sqlite.prepare(
        "SELECT count(*) AS count FROM messages",
      ).get()).toEqual({ count: 2 })
      expect(fixture.sqlite.prepare(`
        SELECT count(*) AS count FROM jarvis_bridge_events
        WHERE event_type = 'assistance.responded'
      `).get()).toEqual({ count: 1 })
    } finally {
      fixture.sqlite.close()
    }
  })
})
