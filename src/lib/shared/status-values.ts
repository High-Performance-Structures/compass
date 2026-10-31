/*
 * Pure helpers for scripts/status-values-report.mjs: compare the values
 * stored in an enumerated column with its shared list, and propose exact
 * normalisations. No database access; the script runs the read-only queries.
 */

/**
 * Spellings that mean the same value. A stored value is rewritten to its
 * partner only when the partner is on the column's list and the stored value
 * is not, so a list that deliberately holds either spelling is left alone.
 */
const KNOWN_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  canceled: ["cancelled"],
  cancelled: ["canceled"],
  complete: ["completed"],
  completed: ["complete"],
  archive: ["archived"],
  archived: ["archive"],
}

type StatusValueVerdict =
  | { readonly kind: "listed" }
  | { readonly kind: "variant"; readonly canonical: string; readonly reason: "case_or_spacing" | "known_spelling" }
  | { readonly kind: "unknown" }

/** Case, surrounding space and inner space/hyphen differences removed. */
function folded(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

/**
 * Whether a stored value is on the list, is an exact variant of exactly one
 * listed value (case, whitespace, or a known spelling), or is unknown. A value
 * that could map to more than one listed value is unknown: never guessed.
 */
export function classifyStatusValue(value: string, list: readonly string[]): StatusValueVerdict {
  if (list.includes(value)) return { kind: "listed" }
  const byCase = list.filter((item) => folded(item) === folded(value))
  if (byCase.length === 1 && byCase[0] !== undefined) {
    return { kind: "variant", canonical: byCase[0], reason: "case_or_spacing" }
  }
  if (byCase.length > 1) return { kind: "unknown" }
  const spellings = KNOWN_SPELLINGS[folded(value)] ?? []
  const bySpelling = list.filter((item) => spellings.includes(folded(item)))
  if (bySpelling.length === 1 && bySpelling[0] !== undefined) {
    return { kind: "variant", canonical: bySpelling[0], reason: "known_spelling" }
  }
  return { kind: "unknown" }
}

function sqlIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return `"${name}"`
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** One read-only SELECT DISTINCT for one column of one table. */
export function distinctValuesSql(table: string, column: string): string {
  const col = sqlIdentifier(column)
  return `SELECT DISTINCT ${col} AS value FROM ${sqlIdentifier(table)} WHERE ${col} IS NOT NULL`
}

/** The UPDATE that rewrites one exact stored value to its listed spelling. Written to a file, never run here. */
export function normalisationSql(table: string, column: string, from: string, to: string): string {
  const col = sqlIdentifier(column)
  return `UPDATE ${sqlIdentifier(table)} SET ${col} = ${sqlString(to)} WHERE ${col} = ${sqlString(from)};`
}

export type StatusColumn = {
  readonly table: string
  readonly column: string
  readonly listName: string
  readonly list: readonly string[]
}

export type ColumnReport = {
  readonly table: string
  readonly column: string
  readonly listName: string
  readonly listed: readonly string[]
  readonly variants: readonly { readonly value: string; readonly canonical: string; readonly reason: string }[]
  readonly unknown: readonly string[]
}

/** Sorts one column's stored values into listed, exact variants, and unknown values for review. */
export function reportColumn(column: StatusColumn, stored: readonly string[]): ColumnReport {
  const listed: string[] = []
  const variants: { readonly value: string; readonly canonical: string; readonly reason: string }[] = []
  const unknown: string[] = []
  for (const value of stored) {
    const verdict = classifyStatusValue(value, column.list)
    if (verdict.kind === "listed") listed.push(value)
    else if (verdict.kind === "variant") variants.push({ value, canonical: verdict.canonical, reason: verdict.reason })
    else unknown.push(value)
  }
  return { table: column.table, column: column.column, listName: column.listName, listed, variants, unknown }
}

/** Every proposed UPDATE for a set of column reports, one statement per stored variant. */
export function normalisationScript(reports: readonly ColumnReport[]): readonly string[] {
  return reports.flatMap((report) =>
    report.variants.map((variant) => normalisationSql(report.table, report.column, variant.value, variant.canonical)),
  )
}
