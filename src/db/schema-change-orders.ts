/*
 * Change orders: the change order record, its lines, attached documents and
 * history.
 * Written by: src/lib/domain/estimates/ (change orders belong to estimates).
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  CHANGE_ORDER_ACCEPTANCE_METHODS,
  CHANGE_ORDER_KINDS,
  CHANGE_ORDER_LINE_DERIVATIONS,
  CHANGE_ORDER_RECORD_TYPES,
  CHANGE_ORDER_STATUSES,
} from "../lib/domain/estimates/statuses"
import { projectContacts } from "./schema-contacts"
import { users } from "./schema-identity"
import { projects } from "./schema-projects"

export const projectChangeOrders = sqliteTable(
  "project_change_orders",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderNumber: text("change_order_number").notNull(),
    /** change_order or variance (0299); variances are numbered V-001 and need no owner acceptance. */
    recordType: text("record_type", { enum: CHANGE_ORDER_RECORD_TYPES }).notNull().default("change_order"),
    /** The CO number a variance had before it was reclassified, so it's never reused (0299). */
    formerChangeOrderNumber: text("former_change_order_number"),
    title: text("title").notNull(),
    scope: text("scope").notNull(),
    reason: text("reason"),
    amountCents: integer("amount_cents"),
    scheduleImpactDays: integer("schedule_impact_days"),
    status: text("status", { enum: CHANGE_ORDER_STATUSES }).notNull().default("draft"),
    audience: text("audience").notNull().default("internal"),
    requesterType: text("requester_type").notNull(),
    requesterUserId: text("requester_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requesterName: text("requester_name").notNull(),
    requesterCompany: text("requester_company"),
    sourceType: text("source_type").notNull(),
    sourceRecordId: text("source_record_id"),
    sourceHref: text("source_href"),
    internalNotes: text("internal_notes"),
    budgetTreatment: text("budget_treatment").notNull().default("additive"),
    // See src/lib/change-orders/kinds.ts; NULL for older recorded change orders.
    changeOrderKind: text("change_order_kind", { enum: CHANGE_ORDER_KINDS }),
    baselineEstimateId: text("baseline_estimate_id"),
    replacementEstimateId: text("replacement_estimate_id"),
    rebaselineExecutionToken: text("rebaseline_execution_token"),
    rebaselineCompletedAt: text("rebaseline_completed_at"),
    rebaselineCompletedBy: text("rebaseline_completed_by").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    foxitStatus: text("foxit_status").notNull().default("not_started"),
    foxitEnvelopeId: text("foxit_envelope_id"),
    signatureRequestedAt: text("signature_requested_at"),
    executedAt: text("executed_at"),
    executedDocumentUrl: text("executed_document_url"),
    executedDocumentLabel: text("executed_document_label"),
    // Manual acceptance (0297); see src/lib/change-orders/manual-acceptance.ts.
    acceptanceMethod: text("acceptance_method", { enum: CHANGE_ORDER_ACCEPTANCE_METHODS }),
    acceptedByContactId: text("accepted_by_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" }
    ),
    // snapshot: the approver's name as recorded when the acceptance was recorded.
    acceptedByNameSnapshot: text("accepted_by_name_snapshot"),
    acceptedOn: text("accepted_on"),
    acceptanceRecordedBy: text("acceptance_recorded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptanceNote: text("acceptance_note"),
    sageStatus: text("sage_status").notNull().default("not_ready"),
    sageRecordId: text("sage_record_id"),
    lastSageSyncAt: text("last_sage_sync_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: text("submitted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_change_orders_accepted_by_contact_idx").on(table.acceptedByContactId),
    index("project_change_orders_acceptance_recorded_by_idx").on(table.acceptanceRecordedBy),
    uniqueIndex("project_change_orders_project_number_uq").on(
      table.projectId,
      table.changeOrderNumber
    ),
    index("project_change_orders_project_status_idx").on(
      table.projectId,
      table.status
    ),
    index("project_change_orders_requester_idx").on(
      table.projectId,
      table.requesterUserId
    ),
    index("project_change_orders_budget_treatment_idx").on(
      table.projectId,
      table.budgetTreatment,
      table.status
    ),
    index("project_change_orders_replacement_estimate_idx").on(
      table.replacementEstimateId
    ),
    uniqueIndex("project_change_orders_rebaseline_execution_token_uq").on(
      table.rebaselineExecutionToken
    ),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("project_change_orders_baseline_estimate_id_idx").on(table.baselineEstimateId),
    index("project_change_orders_record_type_idx").on(table.projectId, table.recordType, table.status),
  ]
)

export const projectChangeOrderLines = sqliteTable(
  "project_change_order_lines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    description: text("description").notNull(),
    phaseCode: text("phase_code"),
    costCode: text("cost_code"),
    amountCents: integer("amount_cents"),
    // Set on lines from a contract-estimate version comparison.
    changeKind: text("change_kind"),
    previousAmountCents: integer("previous_amount_cents"),
    newAmountCents: integer("new_amount_cents"),
    // From a change-order estimate: the contract assembly the line changes.
    contractAssemblyId: text("contract_assembly_id"),
    assemblyName: text("assembly_name"),
    /** Set on the builder fee and insurance lines Compass adds on approval (0299); null for priced lines. */
    derivedFrom: text("derived_from", { enum: CHANGE_ORDER_LINE_DERIVATIONS }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_change_order_lines_order_uq").on(
      table.changeOrderId,
      table.lineNumber
    ),
    index("project_change_order_lines_project_idx").on(table.projectId),
    // Declared from drizzle/0278_paper_trail_sweep_indexes.sql: the paper-trail
    // sweep reads max(updated_at) per parent; this makes it one index seek.
    index("project_change_order_lines_order_updated_idx").on(table.changeOrderId, table.updatedAt),
    index("project_change_order_lines_cost_code_idx").on(
      table.projectId,
      table.costCode
    ),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("project_change_order_lines_contract_assembly_id_idx").on(table.contractAssemblyId),
  ]
)

export const projectChangeOrderDocuments = sqliteTable(
  "project_change_order_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_change_order_documents_order_idx").on(table.changeOrderId),
    // Declared from drizzle/0278_paper_trail_sweep_indexes.sql: the paper-trail
    // sweep reads max(updated_at) per parent; this makes it one index seek.
    index("project_change_order_documents_order_created_idx").on(table.changeOrderId, table.createdAt),
    index("project_change_order_documents_project_idx").on(table.projectId),
  ]
)

export const projectChangeOrderHistory = sqliteTable(
  "project_change_order_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    changeOrderId: text("change_order_id")
      .notNull()
      .references(() => projectChangeOrders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status", { enum: CHANGE_ORDER_STATUSES }),
    toStatus: text("to_status", { enum: CHANGE_ORDER_STATUSES }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    note: text("note"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_change_order_history_order_idx").on(
      table.changeOrderId,
      table.createdAt
    ),
    index("project_change_order_history_project_idx").on(table.projectId),
  ]
)

export type ProjectChangeOrder = typeof projectChangeOrders.$inferSelect

export type NewProjectChangeOrder = typeof projectChangeOrders.$inferInsert

export type ProjectChangeOrderLine =
  typeof projectChangeOrderLines.$inferSelect

export type NewProjectChangeOrderLine =
  typeof projectChangeOrderLines.$inferInsert

export type ProjectChangeOrderDocument =
  typeof projectChangeOrderDocuments.$inferSelect

export type NewProjectChangeOrderDocument =
  typeof projectChangeOrderDocuments.$inferInsert

export type ProjectChangeOrderHistory =
  typeof projectChangeOrderHistory.$inferSelect

export type NewProjectChangeOrderHistory =
  typeof projectChangeOrderHistory.$inferInsert
