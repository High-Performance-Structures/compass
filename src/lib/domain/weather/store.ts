/**
 * The only code that writes the shared weather cache's grid points and cells
 * (weather_points, weather_cells; architecture standard, section 1). These
 * rows hold public NWS data keyed by location, not company data, so they
 * carry no organization scope. No auth logic here.
 */
import { and, eq, inArray, lt } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { weatherCells, weatherPoints } from "@/db/schema"
import { chunkD1Rows, chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

type NewWeatherPoint = typeof weatherPoints.$inferInsert
type NewWeatherCell = typeof weatherCells.$inferInsert

async function runBatch(db: Db, statements: readonly BatchItem<"sqlite">[]): Promise<void> {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

/** Queues new grid points to resolve; a point already queued is left alone. */
export async function insertWeatherPointsIfAbsent(
  db: Db,
  rows: readonly NewWeatherPoint[]
): Promise<void> {
  await runBatch(
    db,
    chunkD1Rows(rows).map((chunk) => db.insert(weatherPoints).values(chunk).onConflictDoNothing())
  )
}

/**
 * Re-stamps points and cells as in use so the refresh job keeps them current.
 * Cells are only re-stamped when their last stamp is older than `touchBefore`.
 */
export async function touchWeatherPointsAndCells(
  db: Db,
  input: {
    readonly pointKeys: readonly string[]
    readonly cellKeys: readonly string[]
    readonly now: string
    readonly touchBefore: string
  }
): Promise<void> {
  await runBatch(db, [
    ...chunkD1Values(input.pointKeys).map((part) =>
      db.update(weatherPoints).set({ requestedAt: input.now }).where(inArray(weatherPoints.pointKey, part))
    ),
    ...chunkD1Values(input.cellKeys).map((part) =>
      db
        .update(weatherCells)
        .set({ requestedAt: input.now })
        .where(and(inArray(weatherCells.cellKey, part), lt(weatherCells.requestedAt, input.touchBefore)))
    ),
  ])
}

/** A point NWS does not cover (offshore, outside the US). */
export async function markWeatherPointOutside(db: Db, pointKey: string, now: string): Promise<void> {
  await db.update(weatherPoints).set({ status: "outside", resolvedAt: now }).where(eq(weatherPoints.pointKey, pointKey))
}

/** Links a resolved point to its grid cell, creating the cell if it is new. */
export async function markWeatherPointFound(
  db: Db,
  input: { readonly pointKey: string; readonly cell: NewWeatherCell; readonly now: string }
): Promise<void> {
  await db.insert(weatherCells).values(input.cell).onConflictDoNothing()
  await db
    .update(weatherPoints)
    .set({ status: "found", cellKey: input.cell.cellKey, resolvedAt: input.now })
    .where(eq(weatherPoints.pointKey, input.pointKey))
}

export async function saveWeatherCellForecast(
  db: Db,
  input: {
    readonly cellKey: string
    readonly series: string
    readonly elevationM: number | null
    readonly fetchedAt: string
  }
): Promise<void> {
  await db
    .update(weatherCells)
    .set({
      series: input.series,
      elevationM: input.elevationM,
      fetchedAt: input.fetchedAt,
      failureCount: 0,
      nextAttemptAt: null,
    })
    .where(eq(weatherCells.cellKey, input.cellKey))
}

export async function recordWeatherCellFailure(
  db: Db,
  input: { readonly cellKey: string; readonly failureCount: number; readonly nextAttemptAt: string }
): Promise<void> {
  await db
    .update(weatherCells)
    .set({ failureCount: input.failureCount, nextAttemptAt: input.nextAttemptAt })
    .where(eq(weatherCells.cellKey, input.cellKey))
}
