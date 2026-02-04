import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core"
import { projects, customers, vendors } from "./schema"

// oauth token storage (encrypted at rest)
export const netsuiteAuth = sqliteTable("netsuite_auth", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresIn: integer("expires_in").notNull(),
  tokenType: text("token_type").notNull(),
  issuedAt: integer("issued_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// per-record sync tracking
export const netsuiteSyncMetadata = sqliteTable("netsuite_sync_metadata", {
  id: text("id").primaryKey(),
  localTable: text("local_table").notNull(),
  localRecordId: text("local_record_id").notNull(),
  netsuiteRecordType: text("netsuite_record_type").notNull(),
  netsuiteInternalId: text("netsuite_internal_id"),
  lastSyncedAt: text("last_synced_at"),
  lastModifiedLocal: text("last_modified_local"),
  lastModifiedRemote: text("last_modified_remote"),
  syncStatus: text("sync_status").notNull().default("synced"),
  conflictData: text("conflict_data"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// sync run history
export const netsuiteSyncLog = sqliteTable("netsuite_sync_log", {
  id: text("id").primaryKey(),
  syncType: text("sync_type").notNull(),
  recordType: text("record_type").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  recordsProcessed: integer("records_processed").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  errorSummary: text("error_summary"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
})

// financial tables

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  projectId: text("project_id")
    .references(() => projects.id),
  invoiceNumber: text("invoice_number"),
  status: text("status").notNull().default("draft"),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  amountPaid: real("amount_paid").notNull().default(0),
  amountDue: real("amount_due").notNull().default(0),
  memo: text("memo"),
  lineItems: text("line_items"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const vendorBills = sqliteTable("vendor_bills", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id),
  projectId: text("project_id")
    .references(() => projects.id),
  billNumber: text("bill_number"),
  status: text("status").notNull().default("pending"),
  billDate: text("bill_date").notNull(),
  dueDate: text("due_date"),
  subtotal: real("subtotal").notNull().default(0),
  tax: real("tax").notNull().default(0),
  total: real("total").notNull().default(0),
  amountPaid: real("amount_paid").notNull().default(0),
  amountDue: real("amount_due").notNull().default(0),
  memo: text("memo"),
  lineItems: text("line_items"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  customerId: text("customer_id")
    .references(() => customers.id),
  vendorId: text("vendor_id")
    .references(() => vendors.id),
  projectId: text("project_id")
    .references(() => projects.id),
  paymentType: text("payment_type").notNull(),
  amount: real("amount").notNull(),
  paymentDate: text("payment_date").notNull(),
  paymentMethod: text("payment_method"),
  referenceNumber: text("reference_number"),
  memo: text("memo"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const creditMemos = sqliteTable("credit_memos", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  projectId: text("project_id")
    .references(() => projects.id),
  memoNumber: text("memo_number"),
  status: text("status").notNull().default("draft"),
  issueDate: text("issue_date").notNull(),
  total: real("total").notNull().default(0),
  amountApplied: real("amount_applied").notNull().default(0),
  amountRemaining: real("amount_remaining").notNull().default(0),
  memo: text("memo"),
  lineItems: text("line_items"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// type exports
export type NetSuiteAuth = typeof netsuiteAuth.$inferSelect
export type NetSuiteSyncMetadata = typeof netsuiteSyncMetadata.$inferSelect
export type NetSuiteSyncLog = typeof netsuiteSyncLog.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type VendorBill = typeof vendorBills.$inferSelect
export type NewVendorBill = typeof vendorBills.$inferInsert
export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
export type CreditMemo = typeof creditMemos.$inferSelect
export type NewCreditMemo = typeof creditMemos.$inferInsert
