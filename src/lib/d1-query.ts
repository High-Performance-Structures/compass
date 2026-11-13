import { getTableColumns, sql, type SQL, type Table } from "drizzle-orm"
import type { getDb } from "@/db"

const D1_VALUE_CHUNK_SIZE = 50

/** Keeps dynamic IN predicates below D1's 100-bound-parameter limit. */
export function chunkD1Values<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += D1_VALUE_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + D1_VALUE_CHUNK_SIZE))
  }
  return chunks
}

/** D1 allows at most 100 bound parameters in one statement. */
const D1_MAX_BOUND_PARAMETERS = 100

/**
 * Split rows for a multi-row INSERT so each statement stays under D1's
 * bound-parameter limit. `fixedParameters` counts values bound once per
 * statement (for example literals in an ON CONFLICT ... SET clause).
 */
export function chunkD1Rows<T extends object>(rows: readonly T[], fixedParameters = 0): T[][] {
  const first = rows[0]
  if (first === undefined) return []
  const perRow = Object.keys(first).length
  const size = Math.max(1, Math.floor((D1_MAX_BOUND_PARAMETERS - fixedParameters) / Math.max(1, perRow)))
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

/**
 * Split rows for a multi-row INSERT into `table` so each statement stays under
 * D1's 100-parameter limit. Drizzle binds every column a row leaves to its
 * default (not just the keys you pass), so size chunks by the table's full
 * column count, the most a row can bind. `chunkD1Rows` counts only the
 * passed keys and under-counts tables with defaults.
 */
export function chunkD1InsertRows<T extends object>(table: Table, rows: readonly T[], fixedParameters = 0): T[][] {
  const perRow = Math.max(1, Object.keys(getTableColumns(table)).length)
  const size = Math.max(1, Math.floor((D1_MAX_BOUND_PARAMETERS - fixedParameters) / perRow))
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

/*
 * Batch guards. D1 runs a batch as one transaction but has no interactive
 * transactions, so a check made before the batch can be stale by the time it
 * runs. A guard statement re-checks a condition inside the batch and fails
 * it (rolling every statement back) when the condition no longer holds:
 * json_extract() with a path that isn't a JSON path raises an error that
 * quotes the path, here "Compass batch guard: <label>". Put it first, so the
 * statements after it run only on the state the caller read.
 */
const BATCH_GUARD_PREFIX = "Compass batch guard:"

/** A batch statement that fails the whole batch unless `condition` holds. */
export function batchGuardStatement(db: ReturnType<typeof getDb>, condition: SQL, label: string) {
  return db
    .select({ guard: sql<string>`json_extract('{}', CASE WHEN ${condition} THEN '$' ELSE ${`${BATCH_GUARD_PREFIX} ${label}`} END)` })
    .from(sql`(SELECT 1) AS batch_guard`)
}

/** True when a batch failed because one of its guard statements did; any other error is not. */
export function isBatchGuardFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error)
  return text.includes(BATCH_GUARD_PREFIX)
}
