import { and, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"

import { jarvisBridgeEvents } from "@/db/schema-jarvis"

export const ACKNOWLEDGEMENT_RESERVATION_RESULT =
  JSON.stringify({ acknowledgement: "reserved" })

export const REPLY_RESERVATION_RESULT =
  JSON.stringify({ reply: "reserved" })

// Only these non-terminal results may cross the stale-claim recovery boundary.
export const RECLAIMABLE_RESERVATION_RESULTS = [
  ACKNOWLEDGEMENT_RESERVATION_RESULT,
  REPLY_RESERVATION_RESULT,
] as const

export type BridgeReservationOwnership = Readonly<{
  eventId: string
  claimToken: string
  reservationResult: string | null
}>

type ReservationDb = Readonly<{
  update: (table: typeof jarvisBridgeEvents) => Readonly<{
    set: (values: Readonly<{
      claimedAt: string
      updatedAt: string
    }>) => Readonly<{
      where: (condition: SQL | undefined) => Readonly<{
        returning: (fields: Readonly<{
          id: typeof jarvisBridgeEvents.id
        }>) => Readonly<{
          get: () =>
            | Readonly<{ id: string }>
            | undefined
            | Promise<Readonly<{ id: string }> | undefined>
        }>
      }>
    }>
  }>
}>

export async function renewBridgeReservation(
  db: ReservationDb,
  input: Readonly<{
    eventId: string
    claimToken: string
    reservationResult: string | null
    now: string
  }>,
): Promise<boolean> {
  // This is the final ownership fence before a handler mutates another resource.
  const renewed = await db
    .update(jarvisBridgeEvents)
    .set({ claimedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(jarvisBridgeEvents.id, input.eventId),
      eq(jarvisBridgeEvents.direction, "outbound"),
      eq(jarvisBridgeEvents.status, "processing"),
      eq(jarvisBridgeEvents.claimToken, input.claimToken),
      input.reservationResult === null
        ? isNull(jarvisBridgeEvents.result)
        : eq(jarvisBridgeEvents.result, input.reservationResult),
    ))
    .returning({ id: jarvisBridgeEvents.id })
    .get()
  return renewed !== undefined && renewed !== null
}

export async function runClaimFencedBridgeEffect<TResult>(
  db: ReservationDb,
  reservations: readonly BridgeReservationOwnership[],
  effect: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const now = new Date().toISOString()
  for (const reservation of reservations) {
    const renewed = await renewBridgeReservation(db, {
      ...reservation,
      now,
    })
    if (!renewed) throw new Error("Event claim is no longer active")
  }
  return await effect()
}

export function assertBridgeReservationOwnership<
  TResultKind extends "sync" | "async",
  TRunResult,
  TFullSchema extends Record<string, unknown>,
>(
  db: BaseSQLiteDatabase<TResultKind, TRunResult, TFullSchema>,
  input: BridgeReservationOwnership,
) {
  const resultOwnership = input.reservationResult === null
    ? sql`${jarvisBridgeEvents.result} IS NULL`
    : sql`${jarvisBridgeEvents.result} = ${input.reservationResult}`
  return db.insert(jarvisBridgeEvents).select(
    sql`SELECT
        ${jarvisBridgeEvents.id},
        ${jarvisBridgeEvents.organizationId},
        ${jarvisBridgeEvents.direction},
        ${jarvisBridgeEvents.source},
        ${jarvisBridgeEvents.eventType},
        ${jarvisBridgeEvents.status},
        ${jarvisBridgeEvents.idempotencyKey},
        ${jarvisBridgeEvents.payload},
        ${jarvisBridgeEvents.result},
        ${jarvisBridgeEvents.lastError},
        ${jarvisBridgeEvents.attemptCount},
        ${jarvisBridgeEvents.availableAt},
        ${jarvisBridgeEvents.claimToken},
        ${jarvisBridgeEvents.claimedAt},
        ${jarvisBridgeEvents.feedbackDeskItemId},
        ${jarvisBridgeEvents.completedAt},
        ${jarvisBridgeEvents.createdAt},
        ${jarvisBridgeEvents.updatedAt}
      FROM ${jarvisBridgeEvents}
      WHERE ${jarvisBridgeEvents.id} = ${input.eventId}
        AND NOT (
          ${jarvisBridgeEvents.direction} = 'outbound'
          AND ${jarvisBridgeEvents.status} = 'processing'
          AND ${jarvisBridgeEvents.claimToken} = ${input.claimToken}
          AND ${resultOwnership}
        )
      UNION ALL
      SELECT
        NULL, NULL, 'outbound', 'bridge-assertion', 'bridge.ownership_missing',
        'failed', ${`missing:${input.eventId}`}, '{}', NULL, NULL, 0, '',
        NULL, NULL, NULL, NULL, '', ''
      WHERE NOT EXISTS (
        SELECT 1 FROM ${jarvisBridgeEvents}
        WHERE ${jarvisBridgeEvents.id} = ${input.eventId}
      )`,
  )
}

export function assertBridgeReservationsOwnership<
  TResultKind extends "sync" | "async",
  TRunResult,
  TFullSchema extends Record<string, unknown>,
>(
  db: BaseSQLiteDatabase<TResultKind, TRunResult, TFullSchema>,
  reservations: readonly BridgeReservationOwnership[],
) {
  if (reservations.length === 0) {
    throw new Error("At least one bridge reservation is required")
  }
  const missingReservation = sql.join(
    reservations.map((reservation) => {
      const resultOwnership = reservation.reservationResult === null
        ? sql`${jarvisBridgeEvents.result} IS NULL`
        : sql`${jarvisBridgeEvents.result} = ${reservation.reservationResult}`
      return sql`NOT EXISTS (
        SELECT 1 FROM ${jarvisBridgeEvents}
        WHERE ${jarvisBridgeEvents.id} = ${reservation.eventId}
          AND ${jarvisBridgeEvents.direction} = 'outbound'
          AND ${jarvisBridgeEvents.status} = 'processing'
          AND ${jarvisBridgeEvents.claimToken} = ${reservation.claimToken}
          AND ${resultOwnership}
      )`
    }),
    sql` OR `,
  )
  return db.insert(jarvisBridgeEvents).select(
    sql`SELECT
        NULL, NULL, 'outbound', 'bridge-assertion', 'bridge.ownership_missing',
        'failed', ${`bridge.ownership_missing:${reservations.map((reservation) => reservation.eventId).join(",")}`}, '{}', NULL, NULL, 0, '',
        NULL, NULL, NULL, NULL, '', ''
      WHERE ${missingReservation}`,
  )
}
