import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { is } from "drizzle-orm"
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core"
import { beforeAll, describe, expect, it } from "vitest"

/*
 * Enforces the database rules in docs/development/architecture-standards.md:
 * the Drizzle schema files are the source of truth for every table, column
 * and index the migrations create; every foreign key has an index that starts
 * with it; and internal id columns declare their foreign key.
 *
 * If one of these fails, fix the schema or write an additive migration rather
 * than adding to an allowlist. Every allowlist entry needs a reason next to
 * it. The *_BASELINE lists are frozen ratchets: they may only shrink, and the
 * test fails when an entry no longer applies so it gets deleted.
 */

const ROOT = process.cwd()
const MIGRATIONS_DIR = resolve(ROOT, "drizzle")

const SCHEMA_FILES: readonly string[] = [
  ...readdirSync(join(ROOT, "src/db"))
    .filter((file) => /^schema.*\.ts$/.test(file))
    .map((file) => `src/db/${file}`),
  "src/lib/sync/schema.ts",
].sort()

type Row = Readonly<Record<string, unknown>>

type TestDatabase = {
  readonly exec: (query: string) => void
  readonly prepare: (query: string) => { readonly all: () => readonly unknown[] }
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object"
}

function rows(database: TestDatabase, query: string): readonly Row[] {
  return database.prepare(query).all().filter(isRow)
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function migrationFiles(): readonly string[] {
  // wrangler d1 applies files in name order, so replay them the same way.
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort()
}

async function replayMigrations(): Promise<TestDatabase> {
  let database: TestDatabase
  if ("Bun" in globalThis) {
    const sqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(sqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    database = new sqliteModule.Database(":memory:")
  } else {
    const { default: Database } = await import("better-sqlite3")
    database = new Database(":memory:")
  }
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    )
    try {
      database.exec(sql)
    } catch (error) {
      throw new Error(`migration ${file} failed on a fresh database: ${String(error)}`)
    }
  }
  return database
}

type IndexShape = {
  readonly name: string
  readonly columns: readonly string[]
  readonly unique: boolean
  readonly partial: boolean
}

type TableShape = {
  readonly name: string
  readonly columns: readonly string[]
  readonly indexes: readonly IndexShape[]
  /** First column of the primary key, if any. */
  readonly primaryLead: string | null
  readonly foreignKeys: readonly { readonly columns: readonly string[]; readonly parent: string }[]
  /** Text columns, for the id-column ratchet. */
  readonly textColumns: readonly string[]
}

const EXPRESSION = "<expr>"

function columnName(value: unknown): string {
  return isRow(value) && typeof value.name === "string" ? value.name : EXPRESSION
}

async function loadSchemaTables(): Promise<ReadonlyMap<string, TableShape>> {
  const tables = new Map<string, TableShape>()
  for (const file of SCHEMA_FILES) {
    const mod: Record<string, unknown> = await import(resolve(ROOT, file))
    for (const value of Object.values(mod)) {
      if (!is(value, SQLiteTable)) continue
      const config = getTableConfig(value)
      if (tables.has(config.name)) continue
      const indexes: IndexShape[] = [
        ...config.indexes.map((index) => ({
          name: index.config.name,
          columns: index.config.columns.map(columnName),
          unique: index.config.unique,
          partial: index.config.where !== undefined,
        })),
        ...config.uniqueConstraints.map((constraint) => ({
          name: constraint.getName() ?? "",
          columns: constraint.columns.map((column) => column.name),
          unique: true,
          partial: false,
        })),
        ...config.columns
          .filter((column) => column.isUnique)
          .map((column) => ({
            name: column.uniqueName ?? `${config.name}_${column.name}_unique`,
            columns: [column.name],
            unique: true,
            partial: false,
          })),
      ]
      const inlinePrimary = config.columns.find((column) => column.primary)
      const compositePrimary = config.primaryKeys[0]?.columns[0]
      tables.set(config.name, {
        name: config.name,
        columns: config.columns.map((column) => column.name),
        indexes,
        primaryLead: inlinePrimary?.name ?? compositePrimary?.name ?? null,
        foreignKeys: config.foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference()
          return {
            columns: reference.columns.map((column) => column.name),
            parent: getTableConfig(reference.foreignTable).name,
          }
        }),
        textColumns: config.columns
          .filter((column) => column.columnType === "SQLiteText" && !column.primary)
          .map((column) => column.name),
      })
    }
  }
  return tables
}

function loadDatabaseTables(database: TestDatabase): ReadonlyMap<string, TableShape> {
  const tables = new Map<string, TableShape>()
  const names = rows(
    database,
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' and name <> 'd1_migrations' order by name",
  ).map((row) => str(row.name))
  for (const name of names) {
    const info = rows(database, `PRAGMA table_info("${name}")`)
    const indexes = rows(database, `PRAGMA index_list("${name}")`)
      .filter((index) => index.origin !== "pk")
      .map((index) => ({
        name: str(index.name),
        columns: rows(database, `PRAGMA index_info("${str(index.name)}")`)
          .slice()
          .sort((a, b) => Number(a.seqno) - Number(b.seqno))
          .map((column) => (typeof column.name === "string" ? column.name : EXPRESSION)),
        unique: Number(index.unique) === 1,
        partial: Number(index.partial) === 1,
      }))
    const primary = info
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
    tables.set(name, {
      name,
      columns: info.map((column) => str(column.name)),
      indexes,
      primaryLead: primary.length > 0 ? str(primary[0].name) : null,
      foreignKeys: [],
      textColumns: [],
    })
  }
  return tables
}

function sameColumns(schema: readonly string[], database: readonly string[]): boolean {
  return (
    schema.length === database.length &&
    schema.every((column, i) => column === EXPRESSION || column === database[i])
  )
}

function describeIndex(index: IndexShape): string {
  return `${index.unique ? "unique " : ""}(${index.columns.join(", ")})${index.partial ? " where …" : ""}`
}

/** Every difference between the replayed migrations and the Drizzle schema. */
function schemaDifferences(
  schema: ReadonlyMap<string, TableShape>,
  database: ReadonlyMap<string, TableShape>,
): readonly string[] {
  const differences: string[] = []
  for (const [name, table] of database) {
    const declared = schema.get(name)
    if (!declared) {
      differences.push(`table ${name} exists only in migrations`)
      continue
    }
    for (const column of table.columns) {
      if (!declared.columns.includes(column)) {
        differences.push(`column ${name}.${column} exists only in migrations`)
      }
    }
    for (const column of declared.columns) {
      if (!table.columns.includes(column)) {
        differences.push(`column ${name}.${column} is declared but no migration creates it`)
      }
    }
    // Inline UNIQUE(...) constraints get sqlite_autoindex_* names, so match
    // those to declared unique indexes by shape instead of name.
    const unmatchedDeclared = new Map(declared.indexes.map((index) => [index.name, index]))
    const autoIndexes = table.indexes.filter((index) => index.name.startsWith("sqlite_autoindex_"))
    for (const index of table.indexes) {
      if (index.name.startsWith("sqlite_autoindex_")) continue
      const match = unmatchedDeclared.get(index.name)
      if (!match) {
        differences.push(`index ${name}.${index.name} exists only in migrations`)
        continue
      }
      unmatchedDeclared.delete(index.name)
      if (
        match.unique !== index.unique ||
        match.partial !== index.partial ||
        !sameColumns(match.columns, index.columns)
      ) {
        differences.push(
          `index ${name}.${index.name} is ${describeIndex(index)} in migrations but ${describeIndex(match)} in the schema`,
        )
      }
    }
    for (const auto of autoIndexes) {
      const match = [...unmatchedDeclared.values()].find(
        (index) => index.unique && !index.partial && sameColumns(index.columns, auto.columns),
      )
      if (match) unmatchedDeclared.delete(match.name)
      else differences.push(`unique constraint ${name}(${auto.columns.join(", ")}) exists only in migrations`)
    }
    for (const index of unmatchedDeclared.values()) {
      differences.push(`index ${name}.${index.name} is declared but no migration creates it`)
    }
  }
  for (const name of schema.keys()) {
    if (!database.has(name)) differences.push(`table ${name} is declared but no migration creates it`)
  }
  return differences.sort()
}

/**
 * Frozen differences between the migrations and the Drizzle schema. May only
 * shrink. Each one is a column or table that a migration created but no code
 * uses; dropping them needs a table rebuild, which D1 cannot do safely.
 */
const SCHEMA_DIFFERENCE_BASELINE: Readonly<Record<string, string>> = {
  "column notification_preferences.timezone exists only in migrations":
    "0041 created `timezone`; the schema and code use `time_zone` (added later). Unused leftover.",
  "column project_estimate_lines.include_in_contract_budget exists only in migrations":
    "superseded by contract assemblies; no code reads it.",
  "column project_estimates.estimate_purpose exists only in migrations":
    "superseded by estimate kinds; no code reads it.",
  "table project_agreements exists only in migrations":
    "replaced by contract packets (schema-contracts.ts); kept for history, never read.",
  "table project_number_alias_conflicts exists only in migrations":
    "one-time conflict log from the 0104 alias backfill; never read by the app.",
}

/** Audit columns: who did something. Users are deactivated, not deleted. */
const AUDIT_COLUMN = /(_by|_by_user_id|^actor_user_id|^actor_id|^author_id|^author_user_id|^sender_user_id)$/

const ORG_SCOPE_ONLY =
  "organization scope column; rows are always read through another indexed key, and organizations are never deleted"
const USER_NOT_QUERIED =
  "no query filters on this user column; users are deactivated rather than deleted"

/** Foreign keys that may go without a leading index. */
const UNINDEXED_FOREIGN_KEYS: Readonly<Record<string, string>> = {
  "buildertrend_staging_access_candidates.matched_user_id": USER_NOT_QUERIED,
  "equipment_log_entries.operator_user_id": USER_NOT_QUERIED,
  "feedback_interviews.user_id": USER_NOT_QUERIED,
  "google_project_calendar_subscriptions.user_id": USER_NOT_QUERIED,
  "mcp_usage.user_id": USER_NOT_QUERIED,
  "permission_audit_events.user_id": USER_NOT_QUERIED,
  "plugin_events.user_id": USER_NOT_QUERIED,
  "project_change_orders.requester_user_id": USER_NOT_QUERIED,
  "project_follow_up_reminders.recipient_user_id": USER_NOT_QUERIED,
  "project_warranty_claims.assigned_user_id": USER_NOT_QUERIED,
  "project_warranty_claims.claimant_user_id": USER_NOT_QUERIED,
  "sage_write_approvals.user_id": USER_NOT_QUERIED,
  "internal_duty_entries.organization_id": ORG_SCOPE_ONLY,
  "project_notes.organization_id": ORG_SCOPE_ONLY,
  "project_profile_audit_events.organization_id": ORG_SCOPE_ONLY,
  "project_record_drive_snapshots.organization_id": ORG_SCOPE_ONLY,
  "project_template_applications.organization_id": ORG_SCOPE_ONLY,
  "project_todo_events.organization_id": ORG_SCOPE_ONLY,
  "project_warranty_claim_attachments.organization_id": ORG_SCOPE_ONLY,
  "project_warranty_claim_events.organization_id": ORG_SCOPE_ONLY,
  "recurring_duties.organization_id": ORG_SCOPE_ONLY,
  "sage_contact_change_events.organization_id": ORG_SCOPE_ONLY,
  "sage_contact_create_events.organization_id": ORG_SCOPE_ONLY,
  "sage_contact_link_events.organization_id": ORG_SCOPE_ONLY,
  "weather_schedule_risks.organization_id": ORG_SCOPE_ONLY,
}

/** Id columns that point at another system, not at a Compass table. */
const EXTERNAL_ID_COLUMN =
  /(^(google|sage|foxit|square|buildertrend|bt|gmail|workos|netsuite|stripe|external|youtube|github|goto|realtimekit|calendar|ical|watch|recurring_event|subscription|source)_)|((^|_)(provider|drive|sheet)_)/

/**
 * Frozen list of internal *_id / *_by text columns that have no
 * .references(). May only shrink: add the foreign key (with an additive
 * migration) or move the column to the external pattern above if it really
 * holds another system's id. Many of these are polymorphic (entity_id,
 * record_id) or cross-table ids that predate this check.
 */
const ID_WITHOUT_REFERENCE_BASELINE: readonly string[] = [
  "activity_events.entity_id",
  "agent_action_confirmations.organization_id",
  "agent_config.model_id",
  "agent_items.conversation_id",
  "agent_items.parent_id",
  "agent_usage.model_id",
  "buildertrend_staging_access_candidates.requested_project_id",
  "buildertrend_staging_files.requested_project_id",
  "buildertrend_staging_observations.entity_id",
  "buildertrend_staging_records.promoted_record_id",
  "buildertrend_staging_records.requested_project_id",
  "channel_read_state.last_read_message_id",
  "cherish_pulse_responses.audience_reference_id",
  "compass_project_calendar_members.acl_rule_id",
  "contact_account_link_events.changed_by_user_id",
  "contact_account_link_events.next_user_id",
  "contact_account_link_events.person_id",
  "contact_account_link_events.previous_user_id",
  "contact_merge_events.destination_id",
  "correspondence_attachments.organization_id",
  "correspondence_composition_drafts.organization_id",
  "correspondence_email_deliveries.organization_id",
  "correspondence_email_events.organization_id",
  "correspondence_email_threads.anchor_message_id",
  "correspondence_email_threads.organization_id",
  "correspondence_outbox.recipient_user_id",
  "correspondence_revisions.actor_user_id",
  "correspondence_saved_drafts.organization_id",
  "customer_contacts.merged_into_person_id",
  "customers.merged_into_customer_id",
  "email_reply_threads.channel_id",
  "equipment_log_entries.client_submission_id",
  "feedback_desk_items.assigned_to_user_id",
  "feedback_desk_items.channel_id",
  "feedback_desk_items.delivery_graph_id",
  "feedback_desk_items.delivery_graph_implementation_task_id",
  "feedback_desk_items.delivery_graph_release_task_id",
  "feedback_desk_items.delivery_graph_review_task_id",
  "feedback_desk_items.feature_priority_approved_by",
  "feedback_desk_items.message_id",
  "feedback_desk_items.organization_id",
  "feedback_desk_items.thread_id",
  "feedback_interviews.conversation_id",
  "feedback_maintenance_runs.organization_id",
  "feedback_service_health.organization_id",
  "goto_inbound_events.conversation_id",
  "goto_inbound_events.message_id",
  "goto_inbound_events.trashed_by",
  "goto_inbound_settings.channel_id",
  "inbound_emails.posted_message_id",
  "jarvis_bridge_events.feedback_desk_item_id",
  "jarvis_bridge_events.organization_id",
  "listening_rooms.current_track_id",
  "local_sync_metadata.record_id",
  "message_mentions.target_id",
  "messages.thread_id",
  "mutation_queue.record_id",
  "netsuite_auth.account_id",
  "netsuite_sync_metadata.local_record_id",
  "nutech_catalog_versions.airlite_template_id",
  "nutech_order_workflows.airlite_workbook_id",
  "nutech_order_workflows.tax_entity_id",
  "permission_audit_events.feature_id",
  "print_snapshots.project_id",
  "print_snapshots.user_id",
  "project_budget_applications.billed_by",
  "project_budget_applications.budget_revision_id",
  "project_budget_lines.budget_revision_line_id",
  "project_change_order_lines.contract_assembly_id",
  "project_change_orders.baseline_estimate_id",
  "project_change_orders.replacement_estimate_id",
  "project_contract_budget_adjustments.change_order_id",
  "project_contract_budget_adjustments.change_order_line_id",
  "project_contract_budget_adjustments.contract_assembly_id",
  "project_correspondence.organization_id",
  "project_documents.supersedes_document_id",
  "project_duplicate_decisions.kept_project_id",
  "project_duplicate_decisions.project_a_id",
  "project_duplicate_decisions.project_b_id",
  "project_duplicate_decisions.removed_project_id",
  "project_email_campaigns.organization_id",
  "project_email_campaigns.reply_thread_id",
  "project_estimate_acknowledgements.template_id",
  "project_estimate_assemblies.contract_assembly_id",
  "project_estimate_assembly_copies.organization_id",
  "project_estimate_assembly_copies.target_estimate_id",
  "project_estimate_line_cost_items.rate_book_entry_id",
  "project_estimates.change_order_id",
  "project_estimates.phase_proposal_id",
  "project_external_resource_grants.resource_id",
  "project_family_phases.job_status_id",
  "project_finish_selections.approved_by",
  "project_finish_selections.parent_selection_id",
  "project_job_status_label_conflicts.discarded_status_id",
  "project_job_status_label_conflicts.organization_id",
  "project_job_status_label_conflicts.retained_status_id",
  "project_number_retirements.former_project_id",
  "project_operations.awarded_rfq_id",
  "project_phase_proposals.deduct_change_order_id",
  "project_profile_audit_events.entity_id",
  "project_record_drive_files.existing_file_id",
  "project_record_drive_files.record_id",
  "project_record_drive_snapshots.record_id",
  "project_rfi_attachments.storage_id",
  "project_selection_decision_events.actor_id",
  "project_selection_decision_events.selection_id",
  "project_selection_decisions.approved_by",
  "project_selection_decisions.change_order_id",
  "project_selection_decisions.last_mutation_id",
  "project_selection_requests.last_mutation_id",
  "project_selection_requests.requester_id",
  "project_template_content_items.parent_source_item_id",
  "project_videos.linked_entity_id",
  "project_warranty_claim_attachments.storage_id",
  "projects.job_status_id",
  "projects.plan_set_document_id",
  "role_permission_overrides.feature_id",
  "sage_contact_change_proposals.entity_id",
  "sage_contact_change_proposals.parent_sage_record_id",
  "sage_contact_create_proposals.parent_sage_record_id",
  "sage_contact_read_requests.entity_id",
  "sage_contact_read_requests.parent_sage_record_id",
  "sage_contact_snapshots.entity_id",
  "sage_contact_snapshots.parent_sage_record_id",
  "sage_pay_application_sync_runs.snapshot_id",
  "schedule_task_links.resource_id",
  "shop_ticket_lines.rate_book_entry_id",
  "social_accounts.parent_external_account_id",
  "social_post_media.photo_id",
  "staff_message_events.from_assignee_user_id",
  "staff_message_events.to_assignee_user_id",
  "sync_tombstone.record_id",
  "team_permission_overrides.feature_id",
  "trade_letters.estimate_id",
  "trade_letters.rfq_operation_id",
  "user_model_preference.model_id",
  "user_permission_overrides.feature_id",
  "user_theme_preference.active_theme_id",
  "vendor_contacts.merged_into_person_id",
  "vendors.merged_into_vendor_id",
  "vendors.trade_docs_folder_id",
  "voice_realtimekit_meetings.meeting_id",
  "weather_schedule_risks.rule_id",
  "youtube_channel_connections.channel_id",
]

describe("schema integrity standard", () => {
  let schema: ReadonlyMap<string, TableShape>
  let database: TestDatabase
  let replayed: ReadonlyMap<string, TableShape>

  beforeAll(async () => {
    schema = await loadSchemaTables()
    database = await replayMigrations()
    replayed = loadDatabaseTables(database)
    return () => database.close()
  }, 60_000)

  it("registers every schema file in drizzle.config.ts", () => {
    const config = readFileSync(join(ROOT, "drizzle.config.ts"), "utf8")
    const listed = new Set([...config.matchAll(/"\.\/([^"]+\.ts)"/g)].map((match) => match[1]))
    const missing = SCHEMA_FILES.filter((file) => !listed.has(file))
    expect(missing, "Add these to the schema list in drizzle.config.ts.").toEqual([])
  })

  it("declares in Drizzle every table, column and index the migrations create", () => {
    const differences = schemaDifferences(schema, replayed)
    const unexpected = differences.filter((difference) => !(difference in SCHEMA_DIFFERENCE_BASELINE))
    expect(
      unexpected,
      "Declare these in the src/db/schema*.ts files (or add the missing migration). Expression or COLLATE indexes use a sql`` column.",
    ).toEqual([])
    const stale = Object.keys(SCHEMA_DIFFERENCE_BASELINE).filter((entry) => !differences.includes(entry))
    expect(stale, "These are fixed; delete them from SCHEMA_DIFFERENCE_BASELINE.").toEqual([])
  })

  it("indexes every foreign key column", () => {
    const missing: string[] = []
    for (const table of schema.values()) {
      const leads = new Set(table.indexes.map((index) => index.columns[0]))
      if (table.primaryLead) leads.add(table.primaryLead)
      for (const foreignKey of table.foreignKeys) {
        const column = foreignKey.columns[0]
        if (leads.has(column)) continue
        if (foreignKey.parent === "users" && AUDIT_COLUMN.test(column)) continue
        missing.push(`${table.name}.${column}`)
      }
    }
    const unexpected = missing.filter((entry) => !(entry in UNINDEXED_FOREIGN_KEYS)).sort()
    expect(
      unexpected,
      "Add an index that starts with each of these columns (schema + additive CREATE INDEX IF NOT EXISTS migration).",
    ).toEqual([])
    const stale = Object.keys(UNINDEXED_FOREIGN_KEYS).filter((entry) => !missing.includes(entry))
    expect(stale, "These are indexed now; delete them from UNINDEXED_FOREIGN_KEYS.").toEqual([])
  })

  it("declares a foreign key on every internal id column", () => {
    const missing: string[] = []
    for (const table of schema.values()) {
      const referenced = new Set(table.foreignKeys.flatMap((foreignKey) => foreignKey.columns))
      for (const column of table.textColumns) {
        if (!/(_id|_by)$/.test(column)) continue
        if (referenced.has(column) || EXTERNAL_ID_COLUMN.test(column)) continue
        missing.push(`${table.name}.${column}`)
      }
    }
    const baseline = new Set(ID_WITHOUT_REFERENCE_BASELINE)
    const unexpected = missing.filter((entry) => !baseline.has(entry)).sort()
    expect(
      unexpected,
      "Add .references(() => parent.id) to these columns, or match EXTERNAL_ID_COLUMN if they hold another system's id.",
    ).toEqual([])
    const stale = ID_WITHOUT_REFERENCE_BASELINE.filter((entry) => !missing.includes(entry))
    expect(stale, "These have a foreign key now; delete them from ID_WITHOUT_REFERENCE_BASELINE.").toEqual([])
  })

  it("serves foreign key lookups from the 0275 indexes", () => {
    const plan = (query: string): string =>
      rows(database, `EXPLAIN QUERY PLAN ${query}`)
        .map((row) => str(row.detail))
        .join(" | ")
    expect(plan("select id from task_dependencies where successor_id = 't'")).toContain(
      "task_dependencies_successor_id_idx",
    )
    expect(plan("select id from project_rfis where project_id = 'p'")).toContain(
      "project_rfis_project_id_idx",
    )
    expect(
      plan("select id from notification_deliveries where event_id = 'e'"),
    ).toContain("notification_deliveries_event_id_idx")
  })

  it("keeps 0275 additive", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0275_fk_indexes.sql"), "utf8")
    const statements = sql
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("--"))
    expect(statements.length).toBeGreaterThan(0)
    expect(statements.filter((line) => !/^CREATE INDEX IF NOT EXISTS \w+ ON \w+ \(\w+\);$/.test(line))).toEqual([])
    expect(() => database.exec(sql)).not.toThrow()
  })
})
