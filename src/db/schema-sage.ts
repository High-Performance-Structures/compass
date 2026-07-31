import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { projects, users } from "./schema"

export const sagePayApplicationSyncRuns = sqliteTable(
  "sage_pay_application_sync_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    sageJobId: text("sage_job_id"),
    sageJobNumber: text("sage_job_number"),
    status: text("status").notNull().default("queued"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sourceApplicationId: text("source_application_id"),
    sourceRevision: text("source_revision"),
    sourceHash: text("source_hash"),
    snapshotId: text("snapshot_id"),
    reconciliationJson: text("reconciliation_json"),
    errorMessage: text("error_message"),
    requestedAt: text("requested_at").notNull(),
    capturedAt: text("captured_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sage_pay_app_sync_runs_idempotency_idx").on(
      table.idempotencyKey
    ),
    index("sage_pay_app_sync_runs_project_status_idx").on(
      table.projectId,
      table.status,
      table.requestedAt
    ),
    index("sage_pay_app_sync_runs_claim_idx").on(
      table.status,
      table.claimedAt
    ),
    uniqueIndex("sage_pay_app_sync_runs_active_project_idx")
      .on(table.projectId)
      .where(sql`${table.status} IN ('queued', 'running', 'processing')`),
  ]
)

export const sagePayApplicationSnapshots = sqliteTable(
  "sage_pay_application_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => sagePayApplicationSyncRuns.id, {
        onDelete: "restrict",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceApplicationId: text("source_application_id").notNull(),
    sourceRevision: text("source_revision").notNull(),
    sourceHash: text("source_hash").notNull(),
    applicationNumber: text("application_number").notNull(),
    periodTo: text("period_to"),
    rowCount: integer("row_count").notNull(),
    headerJson: text("header_json").notNull(),
    linesJson: text("lines_json").notNull(),
    reconciliationJson: text("reconciliation_json").notNull(),
    capturedAt: text("captured_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sage_pay_app_snapshots_source_revision_idx").on(
      table.projectId,
      table.sourceApplicationId,
      table.sourceRevision,
      table.sourceHash
    ),
    uniqueIndex("sage_pay_app_snapshots_run_idx").on(table.runId),
    index("sage_pay_app_snapshots_project_captured_idx").on(
      table.projectId,
      table.capturedAt
    ),
  ]
)

export const sageBridgeRequestNonces = sqliteTable(
  "sage_bridge_request_nonces",
  {
    requestId: text("request_id").primaryKey(),
    route: text("route").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("sage_bridge_request_nonces_created_idx").on(table.createdAt),
  ]
)

export const sageBridgeStatus = sqliteTable("sage_bridge_status", {
  id: text("id").primaryKey(),
  lastSeenAt: text("last_seen_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type SagePayApplicationSyncRun =
  typeof sagePayApplicationSyncRuns.$inferSelect
export type SagePayApplicationSnapshot =
  typeof sagePayApplicationSnapshots.$inferSelect
