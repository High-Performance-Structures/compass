import { beforeEach, describe, expect, it, vi } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import {
  assertBridgeReservationOwnership,
  type BridgeReservationOwnership,
} from "@/lib/jarvis/bridge-reservation"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getJarvisBridgeSecrets: vi.fn(),
  getJarvisEnvValue: vi.fn(),
  applyFeedbackLifecycleUpdate: vi.fn(),
  processFeedbackRequesterNotification: vi.fn(),
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
vi.mock("@/lib/jarvis/feedback-status-update", () => ({
  applyFeedbackLifecycleUpdate: mocks.applyFeedbackLifecycleUpdate,
  processFeedbackRequesterNotification: mocks.processFeedbackRequesterNotification,
}))

import { POST } from "../route"

const event = {
  id: "event-1",
  eventType: "feedback.delivery_requested",
  payload: JSON.stringify({
    schemaVersion: 1,
    feedbackDeskItemId: "feedback-1",
    reference: "CFD-feedback-1",
    kind: "bug",
  }),
  feedbackDeskItemId: "feedback-1",
}

const CLAIM_TOKEN = "1d223b6f-20ca-424d-a0b5-e66f2f9be830"

const completeItem = {
  id: "feedback-1",
  deliveryGraphId: "graph-1",
  deliveryGraphStatus: "created",
  deliveryGraphImplementationTaskId: "implementation-1",
  deliveryGraphReviewTaskId: "review-1",
  deliveryGraphReleaseTaskId: "release-1",
}

function configureDb(
  item: Readonly<Record<string, unknown>> | null,
  mutationResults: readonly (Readonly<{ id: string }> | null)[] = [],
  selectedEvent: Readonly<Record<string, unknown>> = event,
) {
  const selectGet = vi.fn()
    .mockResolvedValueOnce(selectedEvent)
    .mockResolvedValueOnce(item)
    .mockResolvedValue(undefined)
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    get: selectGet,
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)

  const mutationGet = vi.fn()
  for (const result of mutationResults) {
    mutationGet.mockResolvedValueOnce(result)
  }
  mutationGet.mockResolvedValue({ id: "event-1" })
  const returning = vi.fn().mockReturnValue({ get: mutationGet })
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  mocks.getDb.mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update,
  })
  return { mutationGet, returning, update, set, where }
}

function createEventSqlite() {
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
      payload, available_at, claim_token, claimed_at, feedback_desk_item_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "event-1",
    "outbound",
    "feedback-desk",
    "feedback.delivery_requested",
    "processing",
    "delivery:event-1",
    "{}",
    "2026-08-21T12:00:00.000Z",
    CLAIM_TOKEN,
    "2026-08-21T12:00:00.000Z",
    "feedback-1",
    "2026-08-21T12:00:00.000Z",
    "2026-08-21T12:00:00.000Z",
  )
  return sqlite
}

function configureSqliteMutationDb(
  item: Readonly<Record<string, unknown>> | null,
  selectedEvent: Readonly<Record<string, unknown>>,
  beforeUpdate: (
    updateNumber: number,
    sqlite: ReturnType<typeof createEventSqlite>,
  ) => void,
) {
  const sqlite = createEventSqlite()
  const db = drizzle(sqlite)
  const selectGet = vi.fn()
    .mockResolvedValueOnce(selectedEvent)
    .mockResolvedValueOnce(item)
    .mockResolvedValue(undefined)
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    get: selectGet,
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)
  let updateNumber = 0
  const update = (...args: Parameters<typeof db.update>) => {
    updateNumber += 1
    beforeUpdate(updateNumber, sqlite)
    return db.update(...args)
  }
  mocks.getDb.mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update,
  })
  return { sqlite, db, update }
}

async function acknowledge(
  body: Readonly<Record<string, unknown>> = {
    status: "completed",
    claimToken: CLAIM_TOKEN,
  },
) {
  return POST(
    new Request("https://compass.example/api/integrations/jarvis/events/event-1/ack", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "event-1" }) },
  )
}

async function acknowledgeFailure() {
  return POST(
    new Request("https://compass.example/api/integrations/jarvis/events/event-1/ack", {
      method: "POST",
      body: JSON.stringify({
        status: "failed",
        error: "worker unavailable",
        claimToken: CLAIM_TOKEN,
      }),
    }),
    { params: Promise.resolve({ id: "event-1" }) },
  )
}

describe("POST /api/integrations/jarvis/events/:id/ack", () => {
  beforeEach(() => {
    mocks.applyFeedbackLifecycleUpdate.mockReset()
    mocks.processFeedbackRequesterNotification.mockReset()
    mocks.processFeedbackRequesterNotification.mockResolvedValue({
      queued: true,
      claimed: true,
      notifiedUserCount: 1,
    })
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

  it("requires the opaque claim token", async () => {
    configureDb(completeItem)

    const response = await acknowledge({ status: "completed" })

    expect(response.status).toBe(400)
    expect(mocks.getDb).not.toHaveBeenCalled()
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

  it("routes graph failures through the lifecycle so the requester is notified", async () => {
    configureDb({ ...completeItem, status: "triaged" })

    const response = await acknowledgeFailure()

    expect(response.status).toBe(200)
    expect(mocks.applyFeedbackLifecycleUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "feedback-1" }),
      expect.objectContaining({
        status: "triaged",
        deliveryRoute: "engineering",
        deliveryGraph: expect.objectContaining({ status: "failed" }),
      }),
      expect.objectContaining({
        eventId: "event-1",
        reservationResult: JSON.stringify({ acknowledgement: "reserved" }),
      }),
    )
  })

  it("requeues the source claim when delivery failure reporting cannot persist", async () => {
    const db = configureDb({ ...completeItem, status: "triaged" })
    mocks.applyFeedbackLifecycleUpdate.mockRejectedValue(
      new Error("feedback lifecycle unavailable"),
    )

    const response = await acknowledgeFailure()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      retryable: true,
      error: "Delivery failure reporting failed",
    })
    expect(db.set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "pending",
      claimToken: null,
      completedAt: null,
    }))
  })

  it("rejects an incomplete-graph retry after a replacement worker reclaims the event", async () => {
    const db = configureDb({
      ...completeItem,
      deliveryGraphReleaseTaskId: null,
    }, [null])

    const response = await acknowledge()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
    expect(db.mutationGet).toHaveBeenCalledOnce()
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })

  it("rejects normal completion after a replacement worker reclaims the event", async () => {
    const db = configureDb(completeItem, [null])

    const response = await acknowledge()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
    expect(db.mutationGet).toHaveBeenCalledOnce()
  })

  it("does not report a delivery failure after its claim is reclaimed", async () => {
    configureDb({ ...completeItem, status: "triaged" }, [null])

    const response = await acknowledgeFailure()

    expect(response.status).toBe(409)
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })

  it("does not persist requester notification work after its claim is reclaimed", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const db = configureDb(completeItem, [null], statusEvent)

    const response = await acknowledge()

    expect(response.status).toBe(409)
    expect(db.mutationGet).toHaveBeenCalledOnce()
    expect(mocks.processFeedbackRequesterNotification).not.toHaveBeenCalled()
  })

  it("rejects requester notification effects after a reserved claim expires and is replaced", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const db = configureDb(
      completeItem,
      [{ id: "event-1" }, null],
      statusEvent,
    )

    const response = await acknowledge()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
    expect(db.mutationGet).toHaveBeenCalledTimes(2)
    expect(mocks.processFeedbackRequesterNotification).not.toHaveBeenCalled()
  })

  it("rejects delivery lifecycle effects after a reserved claim expires and is replaced", async () => {
    const db = configureDb(
      { ...completeItem, status: "triaged" },
      [{ id: "event-1" }, null],
    )

    const response = await acknowledgeFailure()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Event claim is no longer active",
    })
    expect(db.mutationGet).toHaveBeenCalledTimes(2)
    expect(mocks.applyFeedbackLifecycleUpdate).not.toHaveBeenCalled()
  })

  it("rejects a paused requester notification in SQLite after replacement", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const state = configureSqliteMutationDb(
      completeItem,
      statusEvent,
      () => {},
    )
    mocks.processFeedbackRequesterNotification.mockImplementation(
      (
        _db: unknown,
        _source: unknown,
        _persist: unknown,
        ownership: BridgeReservationOwnership,
      ) => {
        state.sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET claim_token = 'replacement-claim'
          WHERE id = 'event-1'
        `).run()
        assertBridgeReservationOwnership(state.db, ownership).run()
        return Promise.resolve({
          queued: true,
          claimed: true,
          notifiedUserCount: 1,
        })
      },
    )

    try {
      const response = await acknowledge()

      expect(response.status).toBe(409)
      expect(state.sqlite.prepare(`
        SELECT claim_token AS claimToken
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({ claimToken: "replacement-claim" })
    } finally {
      state.sqlite.close()
    }
  })

  it("rejects a paused lifecycle batch in SQLite after replacement", async () => {
    const state = configureSqliteMutationDb(
      { ...completeItem, status: "triaged" },
      event,
      () => {},
    )
    mocks.applyFeedbackLifecycleUpdate.mockImplementation(
      (
        _db: unknown,
        _item: unknown,
        _update: unknown,
        ownership: BridgeReservationOwnership,
      ) => {
        state.sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET claim_token = 'replacement-claim'
          WHERE id = 'event-1'
        `).run()
        assertBridgeReservationOwnership(state.db, ownership).run()
        return Promise.resolve({
          changed: true,
          notifiedUserCount: 0,
          requesterUpdateQueued: false,
        })
      },
    )

    try {
      const response = await acknowledgeFailure()

      expect(response.status).toBe(409)
      expect(state.sqlite.prepare(`
        SELECT claim_token AS claimToken
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({ claimToken: "replacement-claim" })
    } finally {
      state.sqlite.close()
    }
  })

  it("rejects another event's active token in SQLite", async () => {
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
        payload, available_at, claim_token, claimed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      "event-1",
      "outbound",
      "feedback-desk",
      "feedback.delivery_requested",
      "processing",
      "delivery:event-1",
      "{}",
      "2026-08-21T12:00:00.000Z",
      "event-1-token",
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
    )
    insert.run(
      "event-2",
      "outbound",
      "feedback-desk",
      "feedback.delivery_requested",
      "processing",
      "delivery:event-2",
      "{}",
      "2026-08-21T12:00:00.000Z",
      CLAIM_TOKEN,
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
      "2026-08-21T12:00:00.000Z",
    )
    mocks.getDb.mockReturnValue(drizzle(sqlite))

    try {
      const response = await acknowledge({
        status: "failed",
        error: "stale worker",
        retryAfterSeconds: 60,
        claimToken: CLAIM_TOKEN,
      })

      expect(response.status).toBe(409)
      expect(sqlite.prepare(`
        SELECT status, claim_token AS claimToken, last_error AS lastError
        FROM jarvis_bridge_events WHERE id = ?
      `).get("event-1")).toEqual({
        status: "processing",
        claimToken: "event-1-token",
        lastError: null,
      })
    } finally {
      sqlite.close()
    }
  })

  it("fences the final acknowledgement mutation with the active claim", async () => {
    const state = configureSqliteMutationDb(completeItem, event, (
      updateNumber,
      sqlite,
    ) => {
      if (updateNumber === 1) {
        sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET claim_token = 'replacement-claim'
          WHERE id = 'event-1'
        `).run()
      }
    })

    try {
      const response = await acknowledge()

      expect(response.status).toBe(409)
      expect(state.sqlite.prepare(`
        SELECT status, claim_token AS claimToken
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({
        status: "processing",
        claimToken: "replacement-claim",
      })
    } finally {
      state.sqlite.close()
    }
  })

  it("fences the incomplete-graph retry mutation with outbound direction", async () => {
    const state = configureSqliteMutationDb({
      ...completeItem,
      deliveryGraphReleaseTaskId: null,
    }, event, (updateNumber, sqlite) => {
      if (updateNumber === 1) {
        sqlite.prepare(`
          UPDATE jarvis_bridge_events
          SET direction = 'inbound'
          WHERE id = 'event-1'
        `).run()
      }
    })

    try {
      const response = await acknowledge()

      expect(response.status).toBe(409)
      expect(state.sqlite.prepare(`
        SELECT status, direction
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({
        status: "processing",
        direction: "inbound",
      })
    } finally {
      state.sqlite.close()
    }
  })

  it("fences the requester notification lock with processing status", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const state = configureSqliteMutationDb(
      completeItem,
      statusEvent,
      (updateNumber, sqlite) => {
        if (updateNumber === 1) {
          sqlite.prepare(`
            UPDATE jarvis_bridge_events
            SET status = 'pending'
            WHERE id = 'event-1'
          `).run()
        }
      },
    )

    try {
      const response = await acknowledge()

      expect(response.status).toBe(409)
      expect(mocks.processFeedbackRequesterNotification).not.toHaveBeenCalled()
    } finally {
      state.sqlite.close()
    }
  })

  it("fences requester-notification requeue after a replacement claim", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const state = configureSqliteMutationDb(
      completeItem,
      statusEvent,
      (updateNumber, sqlite) => {
        if (updateNumber === 2) {
          sqlite.prepare(`
            UPDATE jarvis_bridge_events
            SET claim_token = 'replacement-claim'
            WHERE id = 'event-1'
          `).run()
        }
      },
    )
    mocks.processFeedbackRequesterNotification.mockRejectedValue(
      new Error("notification store unavailable"),
    )

    try {
      const response = await acknowledge()

      expect(response.status).toBe(409)
      expect(state.sqlite.prepare(`
        SELECT status, claim_token AS claimToken
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({
        status: "processing",
        claimToken: "replacement-claim",
      })
    } finally {
      state.sqlite.close()
    }
  })

  it("returns requester notification failures to the source claim retry queue", async () => {
    const statusEvent = {
      ...event,
      eventType: "feedback.status_changed",
      idempotencyKey: "notify:feedback-1",
    }
    const db = configureDb(completeItem, [], statusEvent)
    mocks.processFeedbackRequesterNotification.mockRejectedValue(
      new Error("notification store unavailable"),
    )

    const response = await acknowledge()

    expect(response.status).toBe(503)
    expect(mocks.processFeedbackRequesterNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "event-1" }),
      undefined,
      expect.objectContaining({
        eventId: "event-1",
        reservationResult: JSON.stringify({ acknowledgement: "reserved" }),
      }),
    )
    expect(db.mutationGet).toHaveBeenCalledTimes(3)
    expect(db.set).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "pending",
      claimToken: null,
      completedAt: null,
    }))
  })
})
