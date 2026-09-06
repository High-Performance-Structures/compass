import {
  check,
  foreignKey,
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { projects, customers, vendors, organizations } from "./schema"

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
  organizationId: text("organization_id").references(() => organizations.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  projectId: text("project_id")
    .references(() => projects.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
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
}, (table) => [
  uniqueIndex("invoices_scope_record_unique").on(table.organizationId, table.projectId, table.id),
  uniqueIndex("invoices_source_identity_unique")
    .on(table.organizationId, table.sourceSystem, table.sourceExternalId)
    .where(sql`${table.organizationId} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL AND trim(${table.sourceExternalId}) <> ''`),
  check("invoices_source_system_check", sql`${table.sourceSystem} IN ('buildertrend', 'compass', 'manual', 'sage')`),
  check("invoices_source_scope_check", sql`${table.sourceExternalId} IS NULL OR (trim(${table.sourceExternalId}) <> '' AND ${table.organizationId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
])

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
  organizationId: text("organization_id").references(() => organizations.id),
  customerId: text("customer_id")
    .references(() => customers.id),
  vendorId: text("vendor_id")
    .references(() => vendors.id),
  projectId: text("project_id")
    .references(() => projects.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  paymentType: text("payment_type").notNull(),
  amount: real("amount").notNull(),
  grossAmountCents: integer("gross_amount_cents"),
  processingFeeCents: integer("processing_fee_cents"),
  netAmountCents: integer("net_amount_cents"),
  cashReceipt: integer("cash_receipt", { mode: "boolean" }).notNull().default(true),
  paymentDate: text("payment_date").notNull(),
  paymentMethod: text("payment_method"),
  referenceNumber: text("reference_number"),
  memo: text("memo"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("payments_scope_record_unique").on(table.organizationId, table.projectId, table.id),
  uniqueIndex("payments_source_identity_unique")
    .on(table.organizationId, table.sourceSystem, table.sourceExternalId)
    .where(sql`${table.organizationId} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL AND trim(${table.sourceExternalId}) <> ''`),
  check("payments_source_system_check", sql`${table.sourceSystem} IN ('buildertrend', 'compass', 'manual', 'sage')`),
  check("payments_source_scope_check", sql`${table.sourceExternalId} IS NULL OR (trim(${table.sourceExternalId}) <> '' AND ${table.organizationId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
  check("payments_cash_receipt_boolean_check", sql`${table.cashReceipt} IN (0, 1)`),
  check("payments_settlement_cents_check", sql`(
    (${table.grossAmountCents} IS NULL AND ${table.processingFeeCents} IS NULL AND ${table.netAmountCents} IS NULL)
    OR (${table.grossAmountCents} IS NOT NULL AND ${table.processingFeeCents} IS NOT NULL AND ${table.netAmountCents} IS NOT NULL
      AND typeof(${table.grossAmountCents}) = 'integer' AND ${table.grossAmountCents} BETWEEN 0 AND 9007199254740991
      AND typeof(${table.processingFeeCents}) = 'integer' AND ${table.processingFeeCents} BETWEEN 0 AND 9007199254740991
      AND typeof(${table.netAmountCents}) = 'integer' AND ${table.netAmountCents} BETWEEN 0 AND 9007199254740991
      AND ${table.grossAmountCents} = ${table.processingFeeCents} + ${table.netAmountCents})
  `),
])

export const creditMemos = sqliteTable("credit_memos", {
  id: text("id").primaryKey(),
  netsuiteId: text("netsuite_id"),
  organizationId: text("organization_id").references(() => organizations.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  projectId: text("project_id")
    .references(() => projects.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  cashReceipt: integer("cash_receipt", { mode: "boolean" }).notNull().default(false),
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
}, (table) => [
  uniqueIndex("credit_memos_scope_record_unique").on(table.organizationId, table.projectId, table.id),
  uniqueIndex("credit_memos_source_identity_unique")
    .on(table.organizationId, table.sourceSystem, table.sourceExternalId)
    .where(sql`${table.organizationId} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL AND trim(${table.sourceExternalId}) <> ''`),
  check("credit_memos_source_system_check", sql`${table.sourceSystem} IN ('buildertrend', 'compass', 'manual', 'sage')`),
  check("credit_memos_source_scope_check", sql`${table.sourceExternalId} IS NULL OR (trim(${table.sourceExternalId}) <> '' AND ${table.organizationId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
  check("credit_memos_non_cash_check", sql`${table.cashReceipt} = 0`),
])

export const invoicePaymentAllocations = sqliteTable(
  "invoice_payment_allocations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    invoiceId: text("invoice_id").notNull(),
    paymentId: text("payment_id").notNull(),
    allocationCents: integer("allocation_cents").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_payment_allocations_pair_unique").on(table.invoiceId, table.paymentId),
    index("invoice_payment_allocations_scope_idx").on(table.organizationId, table.projectId),
    check("invoice_payment_allocations_positive_check", sql`typeof(${table.allocationCents}) = 'integer' AND ${table.allocationCents} BETWEEN 1 AND 9007199254740991`),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "invoice_payment_allocations_project_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.projectId, invoices.id],
      name: "invoice_payment_allocations_invoice_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.paymentId],
      foreignColumns: [payments.organizationId, payments.projectId, payments.id],
      name: "invoice_payment_allocations_payment_scope_fk",
    }).onDelete("restrict"),
  ],
)

export const invoiceCreditAllocations = sqliteTable(
  "invoice_credit_allocations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    invoiceId: text("invoice_id").notNull(),
    creditMemoId: text("credit_memo_id").notNull(),
    allocationCents: integer("allocation_cents").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_credit_allocations_pair_unique").on(table.invoiceId, table.creditMemoId),
    index("invoice_credit_allocations_scope_idx").on(table.organizationId, table.projectId),
    check("invoice_credit_allocations_positive_check", sql`typeof(${table.allocationCents}) = 'integer' AND ${table.allocationCents} BETWEEN 1 AND 9007199254740991`),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "invoice_credit_allocations_project_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.projectId, invoices.id],
      name: "invoice_credit_allocations_invoice_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.creditMemoId],
      foreignColumns: [creditMemos.organizationId, creditMemos.projectId, creditMemos.id],
      name: "invoice_credit_allocations_credit_scope_fk",
    }).onDelete("restrict"),
  ],
)

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
export type InvoicePaymentAllocation = typeof invoicePaymentAllocations.$inferSelect
export type NewInvoicePaymentAllocation = typeof invoicePaymentAllocations.$inferInsert
export type InvoiceCreditAllocation = typeof invoiceCreditAllocations.$inferSelect
export type NewInvoiceCreditAllocation = typeof invoiceCreditAllocations.$inferInsert
