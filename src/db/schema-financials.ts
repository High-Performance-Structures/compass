/*
 * Project money: budget applications (pay requests) and budget lines,
 * contract deposits, and the Sage cost code list.
 * Written by: src/lib/domain/budget/ and src/lib/domain/financials/.
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

import { PAY_APPLICATION_BILLING_SOURCES } from "../lib/domain/budget/statuses"
import { CONTRACT_DEPOSIT_STATUSES } from "../lib/domain/financials/statuses"
import { vendors } from "./schema-contacts"
import { users } from "./schema-identity"
import { projects } from "./schema-projects"

export const projectBudgetApplications = sqliteTable("project_budget_applications", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  applicationNumber: text("application_number").notNull(),
  periodTo: text("period_to"),
  status: text("status").notNull().default("current"),
  originalContractSum: real("original_contract_sum").notNull().default(0),
  netChanges: real("net_changes").notNull().default(0),
  contractSumToDate: real("contract_sum_to_date").notNull().default(0),
  totalCompletedStoredToDate: real("total_completed_stored_to_date")
    .notNull()
    .default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  totalEarnedLessRetainage: real("total_earned_less_retainage")
    .notNull()
    .default(0),
  previousCertificates: real("previous_certificates").notNull().default(0),
  currentPaymentDue: real("current_payment_due").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  sourceUrl: text("source_url"),
  budgetRevisionId: text("budget_revision_id"),
  /** Contract deposit applied to this draw (dollars, like the G702 fields). */
  depositApplied: real("deposit_applied").notNull().default(0),
  /** auto: Compass applies the unapplied deposit balance; manual: staff set it. */
  depositAppliedMode: text("deposit_applied_mode").notNull().default("auto"),
  /** When staff approved this Compass draw for billing (status "billed"). */
  billedAt: text("billed_at"),
  billedBy: text("billed_by"),
  /** Sage invoice number, entered by staff once the draw is invoiced in Sage. */
  sageInvoiceNumber: text("sage_invoice_number"),
  /** Client detail for this draw; null uses the company default. */
  ownerDetail: text("owner_detail"),
  /** Billed amounts entered in Compass, or synced from Sage (read only in Compass). */
  billingSource: text("billing_source", { enum: PAY_APPLICATION_BILLING_SOURCES }).notNull().default("compass"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_applications_project").on(table.projectId),
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_applications_source").on(table.sourceSystem, table.sourceRecordId),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("project_budget_applications_budget_revision_id_idx").on(table.budgetRevisionId),
  ])

/**
 * Deposits on contracts: requested from and received from the client, then
 * applied to pay applications. Entered in Compass or read from accounting.
 */
export const projectContractDeposits = sqliteTable(
  "project_contract_deposits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** See src/lib/domain/financials/deposit-machine.ts. */
    status: text("status", { enum: CONTRACT_DEPOSIT_STATUSES }).notNull().default("received"),
    requestedAmountCents: integer("requested_amount_cents"),
    requestedAt: text("requested_at"),
    dueDate: text("due_date"),
    receivedAmountCents: integer("received_amount_cents"),
    receivedAt: text("received_at"),
    paymentMethod: text("payment_method"),
    reference: text("reference"),
    evidenceUrl: text("evidence_url"),
    evidenceLabel: text("evidence_label"),
    notes: text("notes"),
    /** A deposit request's message to the client, printed on the request. */
    requestMessage: text("request_message"),
    sourceSystem: text("source_system").notNull().default("compass"),
    sourceRecordId: text("source_record_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("project_contract_deposits_project_idx").on(table.projectId, table.status),
    // Declared from drizzle/0232_contract_deposits.sql.
    uniqueIndex("project_contract_deposits_source_idx").on(table.sourceSystem, table.sourceRecordId).where(sql`"source_record_id" IS NOT NULL`)]
)

export const projectBudgetLines = sqliteTable("project_budget_lines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  applicationId: text("application_id").references(
    () => projectBudgetApplications.id,
    { onDelete: "set null" }
  ),
  budgetRevisionLineId: text("budget_revision_line_id"),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  costCode: text("cost_code").notNull(),
  csiDivision: text("csi_division").notNull(),
  csiDivisionName: text("csi_division_name").notNull(),
  description: text("description").notNull(),
  notes: text("notes"),
  originalEstimate: real("original_estimate").notNull().default(0),
  priorChanges: real("prior_changes").notNull().default(0),
  currentChanges: real("current_changes").notNull().default(0),
  totalChanges: real("total_changes").notNull().default(0),
  adjustedEstimate: real("adjusted_estimate").notNull().default(0),
  previousWorkCompleted: real("previous_work_completed").notNull().default(0),
  currentWorkCompleted: real("current_work_completed").notNull().default(0),
  storedMaterials: real("stored_materials").notNull().default(0),
  /** Estimate assembly ("asm:<id>") or change order ("co:<id>") this row bills; null when none. */
  assemblyKey: text("assembly_key"),
  assemblyName: text("assembly_name"),
  assemblySort: integer("assembly_sort").notNull().default(0),
  priorCosts: real("prior_costs").notNull().default(0),
  currentCosts: real("current_costs").notNull().default(0),
  totalCosts: real("total_costs").notNull().default(0),
  percentComplete: real("percent_complete").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  // Fallback copy, not a snapshot: reads prefer the linked vendor (vendorId).
  vendorName: text("vendor_name"),
  /** The directory vendor for this budget line (0280); null until linked. */
  vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  ownerLabel: text("owner_label"),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  internalNotes: text("internal_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_lines_project").on(table.projectId),
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_lines_application").on(table.applicationId),
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_lines_csi").on(table.projectId, table.csiDivision),
    // Declared from drizzle/0035_project_budget.sql.
    index("idx_project_budget_lines_owner").on(table.projectId, table.ownerVisible),
    // Declared from drizzle/0280_relational_directory_links.sql.
    index("project_budget_lines_vendor_id_idx").on(table.vendorId),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("project_budget_lines_budget_revision_line_id_idx").on(table.budgetRevisionLineId),
  ])

export const sageCostCodes = sqliteTable("sage_cost_codes", {
  id: text("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  code: text("code").notNull(),
  description: text("description").notNull(),
  displayLabel: text("display_label").notNull(),
  divisionCode: text("division_code").notNull(),
  divisionDescription: text("division_description").notNull(),
  divisionDisplayLabel: text("division_display_label").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0045_sage_cost_codes.sql.
    index("idx_sage_cost_codes_code").on(table.code),
    // Declared from drizzle/0045_sage_cost_codes.sql.
    index("idx_sage_cost_codes_division").on(table.divisionCode),
    // Declared from drizzle/0045_sage_cost_codes.sql.
    index("idx_sage_cost_codes_active").on(table.active),
  ])

export type ProjectBudgetApplication =
  typeof projectBudgetApplications.$inferSelect

export type NewProjectBudgetApplication =
  typeof projectBudgetApplications.$inferInsert

export type ProjectBudgetLine = typeof projectBudgetLines.$inferSelect

export type NewProjectBudgetLine = typeof projectBudgetLines.$inferInsert

export type SageCostCode = typeof sageCostCodes.$inferSelect

export type NewSageCostCode = typeof sageCostCodes.$inferInsert
