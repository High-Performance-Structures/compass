import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { jarvisBridgeEvents } from "@/db/schema-jarvis"

import {
  ACKNOWLEDGEMENT_RESERVATION_RESULT,
  assertBridgeReservationOwnership,
  renewBridgeReservation,
} from "../bridge-reservation"

function reservationDatabase() {
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
      payload, result, available_at, claim_token, claimed_at,
      created_at, updated_at
    ) VALUES (?, 'outbound', 'feedback-desk', 'feedback.status_changed',
      'processing', ?, '{}', ?, ?, ?, ?, ?, ?)
  `).run(
    "event-1",
    "status:event-1",
    ACKNOWLEDGEMENT_RESERVATION_RESULT,
    "2026-08-22T03:00:00.000Z",
    "replacement-claim",
    "2026-08-22T03:00:00.000Z",
    "2026-08-22T02:00:00.000Z",
    "2026-08-22T03:00:00.000Z",
  )
  return { sqlite, db: drizzle(sqlite) }
}

describe("bridge side-effect reservations", () => {
  it("rejects a stale worker before it crosses the side-effect boundary", async () => {
    const fixture = reservationDatabase()

    try {
      await expect(renewBridgeReservation(fixture.db, {
        eventId: "event-1",
        claimToken: "stale-claim",
        reservationResult: ACKNOWLEDGEMENT_RESERVATION_RESULT,
        now: "2026-08-22T03:01:00.000Z",
      })).resolves.toBe(false)
      expect(fixture.sqlite.prepare(`
        SELECT claim_token AS claimToken, claimed_at AS claimedAt
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({
        claimToken: "replacement-claim",
        claimedAt: "2026-08-22T03:00:00.000Z",
      })
    } finally {
      fixture.sqlite.close()
    }
  })

  it("renews the current reservation before crossing the side-effect boundary", async () => {
    const fixture = reservationDatabase()

    try {
      await expect(renewBridgeReservation(fixture.db, {
        eventId: "event-1",
        claimToken: "replacement-claim",
        reservationResult: ACKNOWLEDGEMENT_RESERVATION_RESULT,
        now: "2026-08-22T03:01:00.000Z",
      })).resolves.toBe(true)
      expect(fixture.sqlite.prepare(`
        SELECT claim_token AS claimToken, claimed_at AS claimedAt
        FROM jarvis_bridge_events WHERE id = 'event-1'
      `).get()).toEqual({
        claimToken: "replacement-claim",
        claimedAt: "2026-08-22T03:01:00.000Z",
      })
    } finally {
      fixture.sqlite.close()
    }
  })

  it("rolls back a guarded effect after a replacement takes ownership", () => {
    const fixture = reservationDatabase()
    const ownershipAssertion = assertBridgeReservationOwnership(fixture.db, {
      eventId: "event-1",
      claimToken: "stale-claim",
      reservationResult: ACKNOWLEDGEMENT_RESERVATION_RESULT,
    })
    const effect = fixture.db.insert(jarvisBridgeEvents).values({
      id: "effect-1",
      organizationId: "org-1",
      direction: "inbound",
      source: "test",
      eventType: "test.effect",
      status: "completed",
      idempotencyKey: "effect-1",
      payload: "{}",
      availableAt: "2026-08-22T03:00:00.000Z",
      completedAt: "2026-08-22T03:00:00.000Z",
      createdAt: "2026-08-22T03:00:00.000Z",
      updatedAt: "2026-08-22T03:00:00.000Z",
    }).onConflictDoNothing()
    const guardedEffect = fixture.sqlite.transaction(() => {
      ownershipAssertion.run()
      effect.run()
    })

    try {
      expect(guardedEffect).toThrow()
      expect(fixture.sqlite.prepare(
        "SELECT id FROM jarvis_bridge_events WHERE id = ?",
      ).get("effect-1")).toBeUndefined()
    } finally {
      fixture.sqlite.close()
    }
  })

  it("asserts ownership for a null-result notification claim", () => {
    const fixture = reservationDatabase()
    fixture.sqlite.prepare(`
      UPDATE jarvis_bridge_events SET result = NULL
      WHERE id = 'event-1'
    `).run()
    const ownershipAssertion = assertBridgeReservationOwnership(fixture.db, {
      eventId: "event-1",
      claimToken: "stale-claim",
      reservationResult: null,
    })

    try {
      expect(() => ownershipAssertion.run()).toThrow()
    } finally {
      fixture.sqlite.close()
    }
  })

  it("rejects a completed result when null-result ownership is required", () => {
    const fixture = reservationDatabase()
    const ownershipAssertion = assertBridgeReservationOwnership(fixture.db, {
      eventId: "event-1",
      claimToken: "replacement-claim",
      reservationResult: null,
    })

    try {
      expect(() => ownershipAssertion.run()).toThrow()
    } finally {
      fixture.sqlite.close()
    }
  })

  it("fails closed when the reserved event no longer exists", () => {
    const fixture = reservationDatabase()
    fixture.sqlite.prepare(
      "DELETE FROM jarvis_bridge_events WHERE id = 'event-1'",
    ).run()
    const ownershipAssertion = assertBridgeReservationOwnership(fixture.db, {
      eventId: "event-1",
      claimToken: "replacement-claim",
      reservationResult: ACKNOWLEDGEMENT_RESERVATION_RESULT,
    })

    try {
      expect(() => ownershipAssertion.run()).toThrow()
    } finally {
      fixture.sqlite.close()
    }
  })
})
