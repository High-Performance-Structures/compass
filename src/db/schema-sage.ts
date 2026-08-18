import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import { customers, organizations, projects, users } from "./schema"

export const sageWriteApprovals = sqliteTable(
  "sage_write_approvals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: text("approved_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sage_write_approvals_org_user_idx").on(
      table.organizationId,
      table.userId
    ),
  ]
)

export const sageClientProjectWriteOperations = sqliteTable(
  "sage_client_project_write_operations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    operationType: text("operation_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("queued"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sageClientId: text("sage_client_id"),
    sageClientNumber: text("sage_client_number"),
    sageJobId: text("sage_job_id"),
    sageJobNumber: text("sage_job_number"),
    resolvedClientStatusNumber: integer("resolved_client_status_number"),
    resolvedJobStatusNumber: integer("resolved_job_status_number"),
    resolvedJobTypeNumber: integer("resolved_job_type_number"),
    errorMessage: text("error_message"),
    requestedAt: text("requested_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("sage_client_project_writes_idempotency_idx").on(
      table.idempotencyKey
    ),
    index("sage_client_project_writes_claim_idx").on(
      table.status,
      table.claimedAt,
      table.requestedAt
    ),
    index("sage_client_project_writes_project_idx").on(
      table.projectId,
      table.status
    ),
    index("sage_client_project_writes_customer_idx").on(
      table.customerId,
      table.status
    ),
  ]
)

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
export type SageWriteApproval = typeof sageWriteApprovals.$inferSelect
export type SageClientProjectWriteOperation =
  typeof sageClientProjectWriteOperations.$inferSelect
