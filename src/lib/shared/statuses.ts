/*
 * Shared status, kind, type and role lists (architecture standard, section 3:
 * "Status and type values come from one list").
 *
 * Each enumerated column's list lives in its owning domain module as an
 * `as const` array, and the Drizzle column is typed with `enum: LIST`. This
 * file holds the helpers every store uses to check writes against a list,
 * plus any list that genuinely crosses domains.
 *
 * Values a company configures (job statuses, trade document types, room
 * names) are data in tables or settings, not lists here. See
 * STATUS_COLUMN_EXEMPTIONS in scripts/architecture-metrics.mjs.
 */

/** True when `value` is one of the list's values. */
export function isListValue<const T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && list.some((item) => item === value)
}

/** The value when it is on the list, otherwise the fallback. */
export function listValueOr<const T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return isListValue(list, value) ? value : fallback
}

/** Field name -> the list its string values must come from. */
export type ListFieldRules = Readonly<Record<string, readonly string[]>>

/**
 * Throws when a row or patch carries a listed field whose string value is not
 * on its list. Missing, null and SQL-expression values are left alone, so a
 * partial patch or a computed `sql\`...\`` value passes through unchanged.
 * Stores call this before every insert or update of an enumerated column.
 */
export function assertListFields(table: string, rows: unknown, rules: ListFieldRules): void {
  const list = Array.isArray(rows) ? rows : [rows]
  for (const row of list) {
    if (typeof row !== "object" || row === null) continue
    for (const [fieldName, allowed] of Object.entries(rules)) {
      const value: unknown = Reflect.get(row, fieldName)
      if (typeof value !== "string") continue
      if (!allowed.includes(value)) {
        throw new Error(`Unknown ${table}.${fieldName} value: ${JSON.stringify(value)}`)
      }
    }
  }
}

/** The value when it is on the list; throws the store's unknown-value error otherwise. */
export function requireListValue<const T extends string>(list: readonly T[], value: unknown, label: string): T {
  if (isListValue(list, value)) return value
  throw new Error(`Unknown ${label} value: ${JSON.stringify(value)}`)
}

/** The rows or patch unchanged, after `assertListFields`; for use inline in a write. */
export function checkedListFields<T>(table: string, rows: T, rules: ListFieldRules): T {
  assertListFields(table, rows, rules)
  return rows
}
