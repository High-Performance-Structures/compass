/*
 * Project operations: to-dos and purchase orders (both in project_operations),
 * to-do history, purchase order lines, RFIs and their attachments.
 * Written by: src/lib/domain/operations/ and src/lib/domain/rfis/.
 */

import { sql } from "drizzle-orm"
import {
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { projectContacts, vendors } from "./schema-contacts"
import { dailyLogs } from "./schema-field"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

export const projectOperations = sqliteTable("project_operations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  assigneeType: text("assignee_type"),
  assigneeName: text("assignee_name"),
  siteContactPhone: text("site_contact_phone"),
  // snapshot: for an RFQ or PO, the company it was requested from or ordered
  // from as sent (also sageVendorName). vendorId links the directory vendor.
  companyName: text("company_name"),
  costCode: text("cost_code"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  amount: real("amount"),
  externalUrl: text("external_url"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  sageVendorId: text("sage_vendor_id"),
  sageVendorName: text("sage_vendor_name"),
  sagePhaseCode: text("sage_phase_code"),
  sageCostCode: text("sage_cost_code"),
  sageTaxGroup: text("sage_tax_group"),
  sageShipTo: text("sage_ship_to"),
  sageOrderDate: text("sage_order_date"),
  sageRequiredDate: text("sage_required_date"),
  sageWriteStatus: text("sage_write_status").notNull().default("not_ready"),
  sagePayloadJson: text("sage_payload_json"),
  syncDirection: text("sync_direction").notNull().default("read"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  /** For a supplier PO: the RFQ whose accepted quote it orders against. */
  awardedRfqId: text("awarded_rfq_id"),
  /** The directory vendor an RFQ or purchase order is with (0280); null when typed or unlinked. */
  vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0032_project_operations.sql.
    index("idx_project_operations_project").on(table.projectId),
    // Declared from drizzle/0032_project_operations.sql.
    index("idx_project_operations_source").on(table.sourceSystem, table.sourceRecordType),
    // Declared from drizzle/0032_project_operations.sql.
    index("idx_project_operations_due").on(table.projectId, table.dueDate),
    // Declared from drizzle/0273_purchase_order_awarded_rfq.sql.
    index("project_operations_awarded_rfq_idx").on(table.awardedRfqId).where(sql`"awarded_rfq_id" IS NOT NULL`),
    // Declared from drizzle/0280_relational_directory_links.sql.
    index("project_operations_vendor_id_idx").on(table.vendorId),
  ])

export const projectPurchaseOrderLines = sqliteTable("project_purchase_order_lines", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => projectOperations.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  lineNumber: integer("line_number").notNull().default(1),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitCost: real("unit_cost").notNull().default(0),
  unit: text("unit"),
  amount: real("amount").notNull().default(0),
  taxGroup: text("tax_group"),
  sagePayloadJson: text("sage_payload_json"),
  syncStatus: text("sync_status").notNull().default("pending_sage"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0042_sage_purchase_order_format.sql.
    index("idx_project_po_lines_operation").on(table.operationId),
    // Declared from drizzle/0278_paper_trail_sweep_indexes.sql: the paper-trail
    // sweep reads max(updated_at) per parent; this makes it one index seek.
    index("idx_project_po_lines_operation_updated").on(table.operationId, table.updatedAt),
    // Declared from drizzle/0042_sage_purchase_order_format.sql.
    index("idx_project_po_lines_project").on(table.projectId),
  ])

export const projectRfis = sqliteTable("project_rfis", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  rfiNumber: text("rfi_number").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("internal"),
  requesterName: text("requester_name"),
  // Fallback copies, not snapshots: reads prefer the linked project contact
  // (assignedProjectContactId), which itself reads the directory.
  assignedToName: text("assigned_to_name"),
  companyName: text("company_name"),
  /** The project contact the RFI is assigned to (0280); null when typed or unlinked. */
  assignedProjectContactId: text("assigned_project_contact_id").references(() => projectContacts.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  submittedAt: text("submitted_at").notNull(),
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    index("project_rfis_project_id_idx").on(table.projectId),
    // Declared from drizzle/0280_relational_directory_links.sql.
    index("project_rfis_assigned_project_contact_id_idx").on(table.assignedProjectContactId),
    uniqueIndex("project_rfis_source_record_unique")
      .on(table.sourceSystem, table.sourceRecordId)
      .where(sql`${table.sourceRecordId} IS NOT NULL`),
  ])

export const projectRfiAttachments = sqliteTable("project_rfi_attachments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  rfiId: text("rfi_id")
    .notNull()
    .references(() => projectRfis.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size").notNull().default(0),
  storageProvider: text("storage_provider").notNull().default("google_drive"),
  storageId: text("storage_id"),
  storageUrl: text("storage_url"),
  storageStatus: text("storage_status").notNull().default("uploaded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0040_project_rfi_attachments.sql.
    index("idx_project_rfi_attachments_project_id").on(table.projectId),
    // Declared from drizzle/0040_project_rfi_attachments.sql.
    index("idx_project_rfi_attachments_rfi_id").on(table.rfiId),
    // Declared from drizzle/0278_paper_trail_sweep_indexes.sql: the paper-trail
    // sweep reads max(updated_at) per parent; this makes it one index seek.
    index("idx_project_rfi_attachments_rfi_updated").on(table.rfiId, table.updatedAt),
    // Declared from drizzle/0040_project_rfi_attachments.sql.
    index("idx_project_rfi_attachments_storage_id").on(table.storageId),
  ])

/**
 * A to-do's history: created (from a daily log or by hand), worked on in a
 * daily log, still blocked or cleared on a log, and status changes. Daily
 * logs only ever record activity here; finishing a to-do is a person's choice.
 */
export const projectTodoEvents = sqliteTable(
  "project_todo_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    todoId: text("todo_id")
      .notNull()
      .references(() => projectOperations.id, { onDelete: "cascade" }),
    /** "created" | "worked" | "still_blocked" | "unblocked" | "completed" | "status" */
    kind: text("kind").notNull(),
    dailyLogId: text("daily_log_id").references(() => dailyLogs.id, {
      onDelete: "set null",
    }),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_todo_events_todo_idx").on(table.todoId, table.createdAt),
    index("project_todo_events_project_idx").on(table.projectId, table.createdAt),
    index("project_todo_events_daily_log_idx").on(table.dailyLogId),
  ],
)

export type ProjectOperation = typeof projectOperations.$inferSelect

export type NewProjectOperation = typeof projectOperations.$inferInsert

export type ProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferSelect

export type NewProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferInsert

export type ProjectRfi = typeof projectRfis.$inferSelect

export type NewProjectRfi = typeof projectRfis.$inferInsert

export type ProjectRfiAttachment = typeof projectRfiAttachments.$inferSelect

export type NewProjectRfiAttachment = typeof projectRfiAttachments.$inferInsert
