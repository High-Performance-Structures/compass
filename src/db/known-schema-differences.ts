/**
 * Tables and columns the migrations create that the Drizzle schema leaves out
 * on purpose: unused leftovers that would need a table rebuild to drop, which
 * D1 cannot do safely. Frozen: the list may only shrink.
 *
 * Read by the schema integrity test (replayed migrations vs the schema) and by
 * the production drift detector (src/lib/domain/data-health), which reports
 * these as known rather than as drift.
 */

export type KnownSchemaDifference =
  | { readonly kind: "table"; readonly table: string; readonly reason: string }
  | { readonly kind: "column"; readonly table: string; readonly column: string; readonly reason: string }

export const KNOWN_MIGRATION_ONLY_SCHEMA: readonly KnownSchemaDifference[] = [
  {
    kind: "column",
    table: "notification_preferences",
    column: "timezone",
    reason: "0041 created `timezone`; the schema and code use `time_zone` (added later). Unused leftover.",
  },
  {
    kind: "column",
    table: "project_estimate_lines",
    column: "include_in_contract_budget",
    reason: "superseded by contract assemblies; no code reads it.",
  },
  {
    kind: "column",
    table: "project_estimates",
    column: "estimate_purpose",
    reason: "superseded by estimate kinds; no code reads it.",
  },
  {
    kind: "table",
    table: "project_agreements",
    reason: "replaced by contract packets (schema-contracts.ts); kept for history, never read.",
  },
  {
    kind: "table",
    table: "project_number_alias_conflicts",
    reason: "one-time conflict log from the 0104 alias backfill; never read by the app.",
  },
]

/** The schema integrity test's wording for a known difference. */
export function knownSchemaDifferenceText(difference: KnownSchemaDifference): string {
  return difference.kind === "table"
    ? `table ${difference.table} exists only in migrations`
    : `column ${difference.table}.${difference.column} exists only in migrations`
}
