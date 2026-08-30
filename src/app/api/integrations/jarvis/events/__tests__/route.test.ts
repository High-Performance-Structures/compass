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
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/jarvis/auth", () => ({
  getJarvisBridgeSecrets: mocks.getJarvisBridgeSecrets,
  getJarvisEnvValue: mocks.getJarvisEnvValue,
  readBoundedBody: mocks.readBoundedBody,
  verifyJarvisRequest: mocks.verifyJarvisRequest,
}))
vi.mock("@/lib/jarvis/feedback-github", () => ({
  linkFeedbackDeskItemToGithub: vi.fn(),
}))
vi.mock("@/lib/jarvis/feedback-desk", () => ({
  enqueueFeedbackReceipt: vi.fn(),
}))
vi.mock("@/lib/jarvis/visual-context", () => ({
  jarvisPayloadForDelivery: vi.fn((_id: string, payload: string) =>
    JSON.parse(payload),
  ),
}))

import * as routeModule from "../route"
import { claimJarvisEvent } from "@/lib/jarvis/event-claim"
import { GET, POST } from "../route"

const CLAIM_TOKEN = "33f7357f-163d-41d2-bcb2-4bd9a7cb047e"

it("keeps non-route claim helpers out of the route export surface", () => {
  expect("claimJarvisEvent" in routeModule).toBe(false)
})

function configureDb(candidateIds = ["event-1"]) {
  const candidateChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(
      candidateIds.map((id) => ({ id })),
    ),
  }
  candidateChain.from.mockReturnValue(candidateChain)
  candidateChain.where.mockReturnValue(candidateChain)
  candidateChain.orderBy.mockReturnValue(candidateChain)

  const claimedChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn().mockResolvedValue([{
      id: "event-1",
      eventType: "feedback.status_changed",
      source: "feedback-widget",
      attemptCount: 2,
      payload: JSON.stringify({ status: "testing" }),
      claimToken: CLAIM_TOKEN,
      createdAt: "2026-08-21T12:00:00.000Z",
    }]),
  }
  claimedChain.from.mockReturnValue(claimedChain)
  claimedChain.where.mockReturnValue(claimedChain)

  const updateReturningGet = vi.fn().mockResolvedValue({ id: "event-1" })
  const updateReturning = vi.fn().mockReturnValue({ get: updateReturningGet })
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  mocks.getDb.mockReturnValue({
    select: vi.fn()
      .mockReturnValueOnce(candidateChain)
      .mockReturnValueOnce(claimedChain),
    update: vi.fn().mockReturnValue({ set: updateSet }),
  })
  return { updateSet }
}

describe("GET /api/integrations/jarvis/events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureDb()
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret" },
    })
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
  })

  it("returns the opaque token that owns each claimed event", async () => {
    const response = await GET(new Request(
      "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      events: [{
        id: "event-1",
        eventType: "feedback.status_changed",
        source: "feedback-widget",
        attempt: 2,
        payload: { status: "testing" },
        claimToken: CLAIM_TOKEN,
        createdAt: "2026-08-21T12:00:00.000Z",
      }],
    })
  })

  it("generates a different opaque token for every event in one pull", async () => {
    const { updateSet } = configureDb(["event-1", "event-2"])

    const response = await GET(new Request(
      "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
    ))
    const firstToken = updateSet.mock.calls[0]?.[0].claimToken
    const secondToken = updateSet.mock.calls[1]?.[0].claimToken

    expect(response.status).toBe(200)
    expect(firstToken).toEqual(expect.any(String))
    expect(secondToken).toEqual(expect.any(String))
    expect(firstToken).not.toBe(secondToken)
  })

  it("persists distinct claim ownership for two events in SQLite", async () => {
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
    `)
    const insert = sqlite.prepare(`
      INSERT INTO jarvis_bridge_events (
        id, direction, source, event_type, status, idempotency_key,
        payload, available_at, created_at, updated_at
      ) VALUES (?, 'outbound', 'feedback-widget', 'feedback.status_changed',
        'pending', ?, '{}', '2026-01-01T00:00:00.000Z', ?, ?)
    `)
    for (const id of ["event-a", "event-b"]) {
      insert.run(
        id,
        `status:${id}`,
        `2026-01-01T00:00:0${id === "event-a" ? "1" : "2"}.000Z`,
        "2026-01-01T00:00:00.000Z",
      )
    }
    const db = drizzle(sqlite)
    mocks.getDb.mockReturnValue(db)

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?limit=2&eventType=feedback.status_changed",
      ))
      const body: unknown = await response.json()
      const events = typeof body === "object" && body !== null
        ? Reflect.get(body, "events")
        : null
      if (!Array.isArray(events)) {
        throw new Error("Expected claimed event array")
      }
      const first = events[0]
      const second = events[1]
      const firstToken = typeof first === "object" && first !== null
        ? Reflect.get(first, "claimToken")
        : null
      const secondToken = typeof second === "object" && second !== null
        ? Reflect.get(second, "claimToken")
        : null

      expect(response.status).toBe(200)
      expect(events).toHaveLength(2)
      expect(firstToken).toEqual(expect.any(String))
      expect(secondToken).toEqual(expect.any(String))
      expect(firstToken).not.toBe(secondToken)
      expect(sqlite.prepare(`
        SELECT id, claim_token AS claimToken
        FROM jarvis_bridge_events ORDER BY id
      `).all()).toEqual([
        { id: "event-a", claimToken: firstToken },
        { id: "event-b", claimToken: secondToken },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("does not bypass a retry delay introduced after candidate selection", async () => {
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
    `)
    sqlite.prepare(`
      INSERT INTO jarvis_bridge_events (
        id, direction, source, event_type, status, idempotency_key,
        payload, available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "event-race",
      "outbound",
      "feedback-widget",
      "feedback.status_changed",
      "pending",
      "status:event-race",
      "{}",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    const db = drizzle(sqlite)
    let updateCount = 0
    const update = (...args: Parameters<typeof db.update>) => {
      updateCount += 1
      if (updateCount === 1) {
        sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET available_at = '9999-01-01T00:00:00.000Z'
          WHERE id = 'event-race'
        `).run()
      }
      return db.update(...args)
    }
    mocks.getDb.mockReturnValue({
      select: db.select.bind(db),
      update,
    })

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ events: [] })
      expect(sqlite.prepare(`
        SELECT status, claim_token AS claimToken, attempt_count AS attemptCount
        FROM jarvis_bridge_events WHERE id = 'event-race'
      `).get()).toEqual({
        status: "pending",
        claimToken: null,
        attemptCount: 0,
      })
    } finally {
      sqlite.close()
    }
  })

  it("does not reclaim an event while a provider attempt is reserved", async () => {
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
        id, direction, source, event_type, status, idempotency_key,
        payload, result, available_at, claim_token, claimed_at,
        created_at, updated_at
      ) VALUES (
        'provider-event', 'outbound', 'ask-jarvis', 'agent.prompt',
        'processing', 'agent:provider-event', '{}',
        'provider-attempt:attempt-1', '2026-01-01T00:00:00.000Z',
        'claim-a', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `)
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=agent.prompt",
      ))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ events: [] })
      expect(sqlite.prepare(
        "SELECT claim_token AS claimToken FROM jarvis_bridge_events WHERE id = ?",
      ).get("provider-event")).toEqual({ claimToken: "claim-a" })
    } finally {
      sqlite.close()
    }
  })

  it("reclaims an expired acknowledgement reservation", async () => {
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
        id, direction, source, event_type, status, idempotency_key,
        payload, result, available_at, claim_token, claimed_at,
        created_at, updated_at
      ) VALUES (
        'event-ack', 'outbound', 'feedback-widget',
        'feedback.status_changed', 'processing', 'status:event-ack', '{}',
        '{"acknowledgement":"reserved"}',
        '2020-01-01T00:00:00.000Z', 'ack-owner',
        '2020-01-01T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
      );
    `)
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))

      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      const events = typeof body === "object" && body !== null
        ? Reflect.get(body, "events")
        : null
      if (!Array.isArray(events)) throw new Error("Expected reclaimed event array")
      expect(events).toHaveLength(1)
      const replacementClaim = Reflect.get(events[0], "claimToken")
      expect(replacementClaim).toEqual(expect.any(String))
      expect(replacementClaim).not.toBe("ack-owner")
      expect(sqlite.prepare(`
        SELECT status, claim_token AS claimToken, result, attempt_count AS attemptCount
        FROM jarvis_bridge_events WHERE id = 'event-ack'
      `).get()).toEqual({
        status: "processing",
        claimToken: replacementClaim,
        result: '{"acknowledgement":"reserved"}',
        attemptCount: 1,
      })
    } finally {
      sqlite.close()
    }
  })

  it("reclaims an expired reply reservation", async () => {
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
        id, direction, source, event_type, status, idempotency_key,
        payload, result, available_at, claim_token, claimed_at,
        created_at, updated_at
      ) VALUES (
        'event-reply', 'outbound', 'compass-conversation',
        'feedback.status_changed', 'processing', 'status:event-reply', '{}',
        '{"reply":"reserved"}',
        '2020-01-01T00:00:00.000Z', 'reply-owner',
        '2020-01-01T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
      );
    `)
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))

      const body: unknown = await response.json()
      const events = typeof body === "object" && body !== null
        ? Reflect.get(body, "events")
        : null
      if (!Array.isArray(events)) throw new Error("Expected reclaimed event array")
      expect(response.status).toBe(200)
      expect(events).toHaveLength(1)
      const replacementClaim = Reflect.get(events[0], "claimToken")
      expect(replacementClaim).toEqual(expect.any(String))
      expect(replacementClaim).not.toBe("reply-owner")
      expect(sqlite.prepare(`
        SELECT claim_token AS claimToken, result, attempt_count AS attemptCount
        FROM jarvis_bridge_events WHERE id = 'event-reply'
      `).get()).toEqual({
        claimToken: replacementClaim,
        result: '{"reply":"reserved"}',
        attemptCount: 1,
      })
    } finally {
      sqlite.close()
    }
  })

  it("leaves an expired provider-attempt marker pending reconciliation", async () => {
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
        result, available_at, claim_token, claimed_at, created_at, updated_at
      ) VALUES (
        'event-provider-crash', 'outbound', 'telegram',
        'feedback.status_changed', 'processing', 'status:event-provider-crash',
        '{}', 'provider-attempt:crashed', '2020-01-01T00:00:00.000Z',
        'crashed-owner', '2020-01-01T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
      );
    `)
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))

      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      const events = typeof body === "object" && body !== null
        ? Reflect.get(body, "events")
        : null
      if (!Array.isArray(events)) throw new Error("Expected event array")
      expect(events).toHaveLength(0)
      expect(sqlite.prepare(`
        SELECT claim_token AS claimToken, result
        FROM jarvis_bridge_events WHERE id = 'event-provider-crash'
      `).get()).toEqual({
        claimToken: "crashed-owner",
        result: "provider-attempt:crashed",
      })
    } finally {
      sqlite.close()
    }
  })

  it("starts the full lease after a delayed candidate read", async () => {
    vi.useFakeTimers()
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
        available_at, created_at, updated_at
      ) VALUES (
        'event-delayed', 'outbound', 'feedback-widget',
        'feedback.status_changed', 'pending', 'status:event-delayed', '{}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `)

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
      const candidate = sqlite.prepare(
        "SELECT id FROM jarvis_bridge_events WHERE status = 'pending'",
      ).get()
      expect(candidate).toEqual({ id: "event-delayed" })
      const delayedPause = new Promise<void>((resolve) => {
        setTimeout(resolve, 6 * 60 * 1000)
      })
      vi.advanceTimersByTime(6 * 60 * 1000)
      await delayedPause
      const claim = await claimJarvisEvent(
        async ({ eventId, claimToken, claimedAt, staleClaimAt }) => {
          const result = sqlite.prepare(`
            UPDATE jarvis_bridge_events
            SET status = 'processing', claim_token = ?, claimed_at = ?,
              attempt_count = attempt_count + 1, updated_at = ?
            WHERE id = ? AND direction = 'outbound'
              AND available_at <= ?
              AND (
                status = 'pending' OR (
                  status = 'processing' AND (
                    result IS NULL OR result IN ('{"acknowledgement":"reserved"}', '{"reply":"reserved"}')
                    OR result LIKE 'provider-attempt:%'
                  ) AND claimed_at < ?
                )
              )
          `).run(
            claimToken,
            claimedAt,
            claimedAt,
            eventId,
            claimedAt,
            staleClaimAt,
          )
          return result.changes === 1
        },
        "event-delayed",
      )

      expect(claim?.claimedAt).toBe("2026-01-01T00:06:00.000Z")
      expect(sqlite.prepare(`
        SELECT status, claimed_at AS claimedAt FROM jarvis_bridge_events
        WHERE id = 'event-delayed'
      `).get()).toEqual({
        status: "processing",
        claimedAt: "2026-01-01T00:06:00.000Z",
      })

      vi.advanceTimersByTime(1_000)
      const secondClaim = await claimJarvisEvent(
        async ({ eventId, claimToken, claimedAt, staleClaimAt }) => {
          const result = sqlite.prepare(`
            UPDATE jarvis_bridge_events
            SET status = 'processing', claim_token = ?, claimed_at = ?,
              attempt_count = attempt_count + 1, updated_at = ?
            WHERE id = ? AND direction = 'outbound'
              AND available_at <= ?
              AND (
                status = 'pending' OR (
                  status = 'processing' AND (
                    result IS NULL OR result IN ('{"acknowledgement":"reserved"}', '{"reply":"reserved"}')
                    OR result LIKE 'provider-attempt:%'
                  ) AND claimed_at < ?
                )
              )
          `).run(
            claimToken,
            claimedAt,
            claimedAt,
            eventId,
            claimedAt,
            staleClaimAt,
          )
          return result.changes === 1
        },
        "event-delayed",
      )
      expect(secondClaim).toBeNull()
    } finally {
      sqlite.close()
      vi.useRealTimers()
    }
  })

  it("does not let a stale worker overlap a claim after a delayed candidate read", async () => {
    vi.useFakeTimers()
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
        available_at, created_at, updated_at
      ) VALUES (
        'event-delayed-race', 'outbound', 'feedback-widget',
        'feedback.status_changed', 'pending', 'status:event-delayed-race', '{}',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `)

    let candidateReadStarted!: () => void
    let releaseCandidateRead!: () => void
    const candidateRead = new Promise<void>((resolve) => {
      candidateReadStarted = resolve
    })
    const candidateRelease = new Promise<void>((resolve) => {
      releaseCandidateRead = resolve
    })
    const realDb = drizzle(sqlite)
    const candidateRows = [{ id: "event-delayed-race" }]
    const candidateChain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn().mockImplementation(() => {
        candidateReadStarted()
        return candidateRelease.then(() => candidateRows)
      }),
    }
    candidateChain.from.mockReturnValue(candidateChain)
    candidateChain.where.mockReturnValue(candidateChain)
    candidateChain.orderBy.mockReturnValue(candidateChain)
    const firstDb = {
      select: vi.fn()
        .mockReturnValueOnce(candidateChain)
        .mockImplementation((...args: Parameters<typeof realDb.select>) =>
          realDb.select(...args)),
      update: realDb.update.bind(realDb),
    }

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
      mocks.getDb.mockReturnValue(firstDb)
      const firstPull = GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))
      await candidateRead

      vi.advanceTimersByTime(6 * 60 * 1000)
      releaseCandidateRead()
      const firstResponse = await firstPull
      expect(firstResponse.status).toBe(200)
      const firstBody: unknown = await firstResponse.json()
      const firstEvents = typeof firstBody === "object" && firstBody !== null
        ? Reflect.get(firstBody, "events")
        : null
      if (!Array.isArray(firstEvents)) throw new Error("Expected first event array")
      expect(firstEvents).toHaveLength(1)
      expect(sqlite.prepare(`
        SELECT status, claimed_at AS claimedAt, attempt_count AS attemptCount
        FROM jarvis_bridge_events WHERE id = 'event-delayed-race'
      `).get()).toEqual({
        status: "processing",
        claimedAt: "2026-01-01T00:06:00.000Z",
        attemptCount: 1,
      })

      mocks.getDb.mockReturnValue(realDb)
      const secondResponse = await GET(new Request(
        "https://compass.example/api/integrations/jarvis/events?eventType=feedback.status_changed",
      ))
      expect(secondResponse.status).toBe(200)
      await expect(secondResponse.json()).resolves.toEqual({ events: [] })
      expect(sqlite.prepare(
        "SELECT attempt_count AS attemptCount FROM jarvis_bridge_events WHERE id = 'event-delayed-race'",
      ).get()).toEqual({ attemptCount: 1 })
    } finally {
      sqlite.close()
      vi.useRealTimers()
    }
  })
})

describe("POST /api/integrations/jarvis/events", () => {
  it("executes a fresh intake insert before resolving the durable item", async () => {
    const body = JSON.stringify({
      source: "telegram",
      sourceEventId: "telegram-message-1",
      eventType: "feedback.reported",
      kind: "bug",
      title: "Fresh report",
      content: "The report should be persisted.",
    })
    const item = { id: "feedback-item-1" }
    let feedbackInsertExecuted = false
    const makeInsert = () => {
      const operation: {
        values: ReturnType<typeof vi.fn>
        onConflictDoNothing: ReturnType<typeof vi.fn>
        then: (resolve: (value: unknown) => unknown) => Promise<unknown>
      } = {
        values: vi.fn(),
        onConflictDoNothing: vi.fn(),
        then: (resolve) => {
          feedbackInsertExecuted = true
          return Promise.resolve(resolve(undefined))
        },
      }
      operation.values.mockReturnValue(operation)
      operation.onConflictDoNothing.mockReturnValue(operation)
      return operation
    }
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      get: vi.fn().mockImplementation(() =>
        feedbackInsertExecuted ? item : undefined,
      ),
    }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    const db = {
      insert: vi.fn(makeInsert),
      select: vi.fn().mockReturnValue(selectChain),
    }
    mocks.getCloudflareContext.mockResolvedValue({
      env: { DB: {}, JARVIS_BRIDGE_SECRET: "secret" },
    })
    mocks.getJarvisBridgeSecrets.mockReturnValue(["secret"])
    mocks.getJarvisEnvValue.mockReturnValue("org-1")
    mocks.readBoundedBody.mockResolvedValue({ success: true, rawBody: body })
    mocks.verifyJarvisRequest.mockResolvedValue({ success: true })
    mocks.getDb.mockReturnValue(db)

    const response = await POST(new Request(
      "https://compass.example/api/integrations/jarvis/events",
      { method: "POST", body },
    ))

    expect(response.status).toBe(202)
    expect(feedbackInsertExecuted).toBe(true)
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})
