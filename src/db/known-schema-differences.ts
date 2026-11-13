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

/**
 * Tables and columns production has that no merged migration creates: left by
 * branches that ran against production but never merged, or by the abandoned
 * Buildertrend 0062 import (still read by the legacy reconciliation in
 * src/lib/domain/buildertrend/legacy-sources.ts). Nothing in the Drizzle
 * schema reads them. The drift detector reports them as known; dropping them
 * needs Martine's OK (production schema change). Frozen: may only shrink.
 */
const UNMERGED = "created on production by a branch that never merged; no code reads it."
const BUILDERTREND_0062 = "abandoned Buildertrend 0062 import table; read only by the legacy reconciliation."

export const KNOWN_PRODUCTION_ONLY_SCHEMA: readonly KnownSchemaDifference[] = [
  { kind: "table", table: "buildertrend_access_candidates", reason: BUILDERTREND_0062 },
  { kind: "table", table: "buildertrend_archive_files", reason: BUILDERTREND_0062 },
  { kind: "table", table: "buildertrend_import_runs", reason: BUILDERTREND_0062 },
  { kind: "table", table: "buildertrend_source_records", reason: BUILDERTREND_0062 },
  { kind: "table", table: "project_role_assignments", reason: UNMERGED },
  { kind: "table", table: "project_vendor_bill_submissions", reason: UNMERGED },
  { kind: "table", table: "project_vendor_bill_submission_lines", reason: UNMERGED },
  { kind: "table", table: "project_vendor_bill_submission_attachments", reason: UNMERGED },
  { kind: "table", table: "user_desk_photos", reason: UNMERGED },
  ...["source_system", "source_record_id", "source_record_number", "source_metadata", "directory_status", "sync_status", "last_synced_at"].map(
    (column): KnownSchemaDifference => ({ kind: "column", table: "customers", column, reason: UNMERGED }),
  ),
  ...["storage_provider", "drive_file_id", "drive_url", "download_url"].map(
    (column): KnownSchemaDifference => ({ kind: "column", table: "message_attachments", column, reason: UNMERGED }),
  ),
  { kind: "column", table: "project_operations", column: "assignee_user_id", reason: UNMERGED },
  { kind: "column", table: "users", column: "workos_user_id", reason: UNMERGED },
]

/** The schema integrity test's wording for a known difference. */
export function knownSchemaDifferenceText(difference: KnownSchemaDifference): string {
  return difference.kind === "table"
    ? `table ${difference.table} exists only in migrations`
    : `column ${difference.table}.${difference.column} exists only in migrations`
}
