import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  verifyJarvisRequest: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))

import { GET } from "../route"

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000"
const ACTIVE_CLAIM = "active-claim"

function request(claimToken?: string): Request {
  return new Request(
    `https://compass.example/api/integrations/jarvis/events/${EVENT_ID}/delivery`,
    claimToken === undefined
      ? undefined
      : { headers: { "X-Compass-Claim-Token": claimToken } },
  )
}

function database(
  lockedEvent: Readonly<Record<string, unknown>> | null,
) {
  const item = {
    reporterEmail: "staff@example.com",
    metadata: JSON.stringify({ externalActorId: "123456" }),
    title: "Feedback title",
    kind: "bug",
  }
  const selectGet = vi.fn().mockResolvedValue(item)
  const selectWhere = vi.fn(() => ({ get: selectGet }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const mutationGet = vi.fn().mockResolvedValue(lockedEvent)
  const returning = vi.fn(() => ({ get: mutationGet }))
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))

  return {
    db: { select, update },
    select,
    update,
    set,
    mutationGet,
  }
}

describe("GET /api/integrations/jarvis/events/:id/delivery", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.getDb.mockReset()
    mocks.getJarvisBridgeSecrets.mockReset()
    mocks.verifyJarvisRequest.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getJarvisBridgeSecrets.mockReturnValue({ primary: "secret" })
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  })

  it("rejects a missing claim token before delivery lookup", async () => {
    const state = database(null)
    mocks.getDb.mockReturnValue(state.db)

    const response = await GET(request(), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(400)
    expect(state.select).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it("rejects a stale claim before requester metadata is read", async () => {
    const state = database(null)
    mocks.getDb.mockReturnValue(state.db)

    const response = await GET(request("stale-claim"), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(409)
    expect(state.update).toHaveBeenCalledTimes(2)
    expect(state.select).not.toHaveBeenCalled()
  })

  it("refreshes the active claim before returning delivery details", async () => {
    const state = database({
      source: "telegram",
      eventType: "feedback.status_changed",
      payload: JSON.stringify({ status: "testing" }),
      feedbackDeskItemId: "feedback-1",
      claimToken: "replacement-claim",
    })
    mocks.getDb.mockReturnValue(state.db)

    const response = await GET(request(ACTIVE_CLAIM), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      claimToken: "replacement-claim",
      message: expect.any(String),
    }))
    expect(state.set).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: expect.any(String),
      claimedAt: expect.any(String),
      result: null,
    }))
  })

  it("preserves a provider-attempt marker while refreshing a recovered claim", async () => {
    const state = database({
      source: "telegram",
      eventType: "feedback.status_changed",
      payload: JSON.stringify({ status: "testing" }),
      feedbackDeskItemId: "feedback-1",
      claimToken: "replacement-claim",
    })
    state.mutationGet
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        source: "telegram",
        eventType: "feedback.status_changed",
        payload: JSON.stringify({ status: "testing" }),
        feedbackDeskItemId: "feedback-1",
        claimToken: "replacement-claim",
      })
    mocks.getDb.mockReturnValue(state.db)

    const response = await GET(request(ACTIVE_CLAIM), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(200)
    expect(state.set).toHaveBeenCalledTimes(2)
    expect(state.set).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ result: expect.anything() }),
    )
  })

  it("lets the active replacement claim clear a legacy delivery reservation", async () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE jarvis_bridge_events (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT,
        direction TEXT NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        result TEXT,
        last_error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        claim_token TEXT,
        claimed_at TEXT,
        feedback_desk_item_id TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE feedback_desk_items (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        reporter_user_id TEXT,
        reporter_email TEXT,
        reporter_external_actor_id TEXT,
        reporter_conversation_id TEXT
      );
    `)
    const reservation = JSON.stringify({ deliveryAttempt: "reserved" })
    sqlite.prepare(`
      INSERT INTO jarvis_bridge_events (
        id, direction, source, event_type, status, idempotency_key,
        payload, result, available_at, claim_token, claimed_at,
        feedback_desk_item_id, created_at, updated_at
      ) VALUES (?, 'outbound', 'telegram', 'feedback.status_changed',
        'processing', ?, '{}', ?, ?, ?, ?, 'feedback-1', ?, ?)
    `).run(
      EVENT_ID,
      `notify:${EVENT_ID}`,
      reservation,
      "2026-08-21T12:00:00.000Z",
      ACTIVE_CLAIM,
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
    )
    sqlite.prepare(`
      INSERT INTO feedback_desk_items (
        id, title, kind, status, metadata, reporter_external_actor_id
      ) VALUES (
        'feedback-1', 'Request', 'bug', 'testing',
        '{"externalActorId":"123456"}', '123456'
      )
    `).run()
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await GET(request(ACTIVE_CLAIM), {
        params: Promise.resolve({ id: EVENT_ID }),
      })

      expect(response.status).toBe(200)
      expect(sqlite.prepare(`
        SELECT claim_token AS claimToken, result
        FROM jarvis_bridge_events WHERE id = ?
      `).get(EVENT_ID)).toEqual({
        claimToken: expect.not.stringMatching(ACTIVE_CLAIM),
        result: null,
      })
    } finally {
      sqlite.close()
    }
  })
})
