import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  verifyJarvisRequest: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))

import { POST } from "../route"

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000"
const CLAIM_TOKEN = "active-claim"

function request(claimToken = CLAIM_TOKEN): Request {
  return new Request(
    `https://compass.example/api/integrations/jarvis/events/${EVENT_ID}/delivery/attempt`,
    { method: "POST", headers: { "X-Compass-Claim-Token": claimToken } },
  )
}

function database(existing: Readonly<Record<string, unknown>> | null) {
  const selectGet = vi.fn().mockResolvedValue(existing)
  const selectWhere = vi.fn(() => ({ get: selectGet }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))
  const mutationGet = vi.fn().mockResolvedValue({ id: EVENT_ID })
  const returning = vi.fn(() => ({ get: mutationGet }))
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  return { db: { select, update }, update, set }
}

describe("POST /api/integrations/jarvis/events/:id/delivery/attempt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getJarvisBridgeSecrets.mockReturnValue({ primary: "secret" })
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  })

  it("reserves a provider attempt under the active claim", async () => {
    const state = database({ result: null, source: "telegram" })
    mocks.getDb.mockReturnValue(state.db)

    const response = await POST(request(), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      outcome: "reserved",
      claimToken: expect.any(String),
      providerAttempt: expect.stringMatching(/^provider-attempt:/),
    })
    expect(state.set).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: expect.any(String),
      result: expect.stringMatching(/^provider-attempt:/),
    }))
  })

  it("returns an unknown outcome instead of authorizing a duplicate after recovery", async () => {
    const state = database({ result: "provider-attempt:crashed", source: "telegram" })
    mocks.getDb.mockReturnValue(state.db)

    const response = await POST(request(), {
      params: Promise.resolve({ id: EVENT_ID }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      outcome: "unknown",
      claimToken: CLAIM_TOKEN,
      providerAttempt: "provider-attempt:crashed",
    })
    expect(state.update).not.toHaveBeenCalled()
  })

  it("persists the provider marker and suppresses a second reservation in SQLite", async () => {
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
      INSERT INTO jarvis_bridge_events (
        id, direction, source, event_type, status, idempotency_key, payload,
        available_at, claim_token, created_at, updated_at
      ) VALUES (
        '${EVENT_ID}', 'outbound', 'telegram', 'feedback.status_changed',
        'processing', 'status:${EVENT_ID}', '{}',
        '2020-01-01T00:00:00.000Z', '${CLAIM_TOKEN}',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
      );
    `)
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const first = await POST(request(), {
        params: Promise.resolve({ id: EVENT_ID }),
      })
      const firstBody: unknown = await first.json()
      if (typeof firstBody !== "object" || firstBody === null) {
        throw new Error("Expected provider reservation response")
      }
      const replacementClaim = Reflect.get(firstBody, "claimToken")
      const providerAttempt = Reflect.get(firstBody, "providerAttempt")
      expect(first.status).toBe(200)
      expect(Reflect.get(firstBody, "outcome")).toBe("reserved")
      expect(replacementClaim).toEqual(expect.any(String))
      expect(providerAttempt).toEqual(expect.stringMatching(/^provider-attempt:/))

      const second = await POST(request(String(replacementClaim)), {
        params: Promise.resolve({ id: EVENT_ID }),
      })
      await expect(second.json()).resolves.toEqual({
        outcome: "unknown",
        claimToken: replacementClaim,
        providerAttempt,
      })
      expect(second.status).toBe(200)
      expect(sqlite.prepare(
        "SELECT claim_token AS claimToken, result FROM jarvis_bridge_events",
      ).get()).toEqual({
        claimToken: replacementClaim,
        result: providerAttempt,
      })
    } finally {
      sqlite.close()
    }
  })
})
