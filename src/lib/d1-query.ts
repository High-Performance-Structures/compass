import { getTableColumns, type Table } from "drizzle-orm"

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
