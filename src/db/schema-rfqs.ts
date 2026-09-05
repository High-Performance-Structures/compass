import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { projectOperations, projects, users } from "./schema"
import { projectEstimateLines, projectEstimates } from "./schema-estimates"

/**
 * Immutable snapshot of the vendor response that staff approved for an RFQ.
 * The RFQ portal response may be revised until approval, so approval must keep
 * its own copy of the exact bid that was selected.
 */
export const projectRfqBidApprovals = sqliteTable(
  "project_rfq_bid_approvals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    rfqOperationId: text("rfq_operation_id")
      .notNull()
      .references(() => projectOperations.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    responseSnapshotJson: text("response_snapshot_json").notNull(),
    responderName: text("responder_name").notNull(),
    responderCompany: text("responder_company"),
    responseSubmittedAt: text("response_submitted_at").notNull(),
    approvalNote: text("approval_note"),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name").notNull(),
    approvedAt: text("approved_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_rfq_bid_approvals_rfq_uq").on(table.rfqOperationId),
    index("project_rfq_bid_approvals_project_idx").on(
      table.projectId,
      table.approvedAt
    ),
  ]
)

/** One immutable import batch per approved RFQ bid. */
export const projectEstimateRfqBidImports = sqliteTable(
  "project_estimate_rfq_bid_imports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    approvalId: text("approval_id")
      .notNull()
      .references(() => projectRfqBidApprovals.id, { onDelete: "restrict" }),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => projectEstimates.id, { onDelete: "restrict" }),
    importedAmountCents: integer("imported_amount_cents").notNull(),
    importedBy: text("imported_by").references(() => users.id, {
      onDelete: "set null",
    }),
    importedByName: text("imported_by_name").notNull(),
    importedAt: text("imported_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_estimate_rfq_bid_imports_approval_uq").on(
      table.approvalId
    ),
    index("project_estimate_rfq_bid_imports_estimate_idx").on(
      table.estimateId,
      table.importedAt
    ),
  ]
)

/** Line-level provenance for every estimate line created by an RFQ import. */
export const projectEstimateRfqBidImportLines = sqliteTable(
  "project_estimate_rfq_bid_import_lines",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => projectEstimateRfqBidImports.id, {
        onDelete: "restrict",
      }),
    estimateLineId: text("estimate_line_id").references(
      () => projectEstimateLines.id,
      { onDelete: "set null" }
    ),
    rfqLineNumber: integer("rfq_line_number").notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    costCodeSnapshot: text("cost_code_snapshot"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_estimate_rfq_bid_import_lines_estimate_line_uq").on(
      table.estimateLineId
    ),
    index("project_estimate_rfq_bid_import_lines_import_idx").on(
      table.importId,
      table.rfqLineNumber
    ),
  ]
)

export type ProjectRfqBidApproval = typeof projectRfqBidApprovals.$inferSelect
export type ProjectEstimateRfqBidImport =
  typeof projectEstimateRfqBidImports.$inferSelect
