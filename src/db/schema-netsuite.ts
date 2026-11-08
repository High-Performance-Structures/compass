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
import { projects, customers, vendors, organizations, projectBudgetApplications, users } from "./schema"
import { projectEstimateLines, projectEstimates, sageTaxEntities } from "./schema-estimates"
import { nuTechProducts } from "./schema-nutech"
import {
  INVOICE_CUSTOMER_TYPES,
  INVOICE_LINE_SOURCES,
  INVOICE_PRICE_MODES,
  INVOICE_SQUARE_STATES,
  SIMPLE_INVOICE_KINDS,
} from "../lib/domain/financials/statuses"

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
  // "preconstruction" billing (design, plans, engineering) sits beside the
  // construction contract and never blocks replacing its estimate.
  billingScope: text("billing_scope").notNull().default("construction"),
  /*
   * Simple invoices built in Compass (drizzle/0306): Nu-Tech sales and
   * one-off work. Null kind = an invoice from before (legacy, Sage or
   * Buildertrend), which keeps its JSON line_items; simple invoices keep
   * their lines in invoice_lines.
   */
  invoiceKind: text("invoice_kind", { enum: SIMPLE_INVOICE_KINDS }),
  /** The n in the kind's Sage invoice number format, per project and kind. */
  sequenceNumber: integer("sequence_number"),
  /** The estimate it bills (in part or in full), when it was started from one. */
  estimateId: text("estimate_id").references(() => projectEstimates.id, { onDelete: "set null" }),
  /** Sales tax district for its taxable lines (Sage adds the tax at this rate). */
  taxEntityId: text("tax_entity_id").references(() => sageTaxEntities.id, { onDelete: "set null" }),
  /** Short description for Sage's invoice header (50 characters). */
  title: text("title"),
  /** A deposit invoice; Square can be blocked for deposits by department (Settings). */
  isDeposit: integer("is_deposit", { mode: "boolean" }).notNull().default(false),
  /** Price list column for catalog items when Square is off; Square always uses the regular price. */
  priceMode: text("price_mode", { enum: INVOICE_PRICE_MODES }).notNull().default("standard"),
  priceCustomerType: text("price_customer_type", { enum: INVOICE_CUSTOMER_TYPES }).notNull().default("returning"),
  /** "Create Square invoice": Compass creates and publishes it in Square, then emails the link. */
  squareRequested: integer("square_requested", { mode: "boolean" }).notNull().default(false),
  squareState: text("square_state", { enum: INVOICE_SQUARE_STATES }).notNull().default("off"),
  squareInvoiceId: text("square_invoice_id"),
  squareOrderId: text("square_order_id"),
  squareCustomerId: text("square_customer_id"),
  /** Square's hosted payment page for the published invoice. */
  squarePublicUrl: text("square_public_url"),
  squareError: text("square_error"),
  finalizedAt: text("finalized_at"),
  finalizedByUserId: text("finalized_by_user_id").references(() => users.id, { onDelete: "set null" }),
  emailedAt: text("emailed_at"),
  emailedByUserId: text("emailed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  voidedAt: text("voided_at"),
  voidedByUserId: text("voided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  voidReason: text("void_reason"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("invoices_scope_record_unique").on(table.organizationId, table.projectId, table.id),
  uniqueIndex("invoices_project_kind_sequence_unique")
    .on(table.projectId, table.invoiceKind, table.sequenceNumber)
    .where(sql`${table.invoiceKind} IS NOT NULL AND ${table.sequenceNumber} IS NOT NULL`),
  index("invoices_estimate_id_idx").on(table.estimateId),
  index("invoices_tax_entity_id_idx").on(table.taxEntityId),
  index("invoices_finalized_by_user_id_idx").on(table.finalizedByUserId),
  index("invoices_emailed_by_user_id_idx").on(table.emailedByUserId),
  index("invoices_voided_by_user_id_idx").on(table.voidedByUserId),
  index("invoices_created_by_user_id_idx").on(table.createdByUserId),
  uniqueIndex("invoices_source_identity_unique")
    .on(table.organizationId, table.sourceSystem, table.sourceExternalId)
    .where(sql`${table.organizationId} IS NOT NULL AND ${table.sourceExternalId} IS NOT NULL AND trim(${table.sourceExternalId}) <> ''`),
  check("invoices_source_system_check", sql`${table.sourceSystem} IN ('buildertrend', 'compass', 'manual', 'sage')`),
  check("invoices_source_scope_check", sql`${table.sourceExternalId} IS NULL OR (trim(${table.sourceExternalId}) <> '' AND ${table.organizationId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`),
    index("invoices_project_id_idx").on(table.projectId),
    index("invoices_customer_id_idx").on(table.customerId),
])

/** A simple invoice's lines (drizzle/0306); a draft's lines are replaced as a whole when it is saved. */
export const invoiceLines = sqliteTable("invoice_lines", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  source: text("source", { enum: INVOICE_LINE_SOURCES }).notNull(),
  /** The estimate line it bills; counts toward that line's invoiced-to-date. */
  estimateLineId: text("estimate_line_id").references(() => projectEstimateLines.id, { onDelete: "set null" }),
  /** The price list product it was picked from (or matched to), for regular-price repricing. */
  nutechProductId: text("nutech_product_id").references(() => nuTechProducts.id, { onDelete: "set null" }),
  costCode: text("cost_code").notNull(),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull().default("EA"),
  unitPriceCents: integer("unit_price_cents").notNull(),
  amountCents: integer("amount_cents").notNull(),
  taxable: integer("taxable", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("invoice_lines_invoice_idx").on(table.invoiceId, table.sortOrder),
  index("invoice_lines_estimate_line_id_idx").on(table.estimateLineId),
  index("invoice_lines_nutech_product_id_idx").on(table.nutechProductId),
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
},
  (table) => [
    index("vendor_bills_project_id_idx").on(table.projectId),
    index("vendor_bills_vendor_id_idx").on(table.vendorId),
  ])

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
  billingScope: text("billing_scope").notNull().default("construction"),
  /** A payment is never deleted once applied; voiding it releases its allocations (0285). */
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by").references(() => users.id, { onDelete: "set null" }),
  voidReason: text("void_reason"),
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
    index("payments_project_id_idx").on(table.projectId),
    index("payments_vendor_id_idx").on(table.vendorId),
    index("payments_customer_id_idx").on(table.customerId),
  // Declared from drizzle/0285_payment_applications.sql.
  index("payments_voided_by_idx").on(table.voidedBy),
  check("payments_void_reason_check", sql`${table.voidReason} IS NULL OR length(trim(${table.voidReason})) > 0`),
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
    index("credit_memos_project_id_idx").on(table.projectId),
    index("credit_memos_customer_id_idx").on(table.customerId),
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
    /** Set when the payment is voided: the row stays as history and stops counting (0285). */
    releasedAt: text("released_at"),
    releasedBy: text("released_by").references(() => users.id, { onDelete: "set null" }),
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
    index("invoice_payment_allocations_project_id_idx").on(table.projectId),
    // Declared from drizzle/0285_payment_applications.sql.
    index("invoice_payment_allocations_payment_idx").on(table.paymentId),
    index("invoice_payment_allocations_released_by_idx").on(table.releasedBy),
  ],
)

/**
 * A received payment applied to a billed pay application (G702 draw). The
 * draw's paid and open amounts are the sum of its unreleased rows; nothing is
 * copied onto the pay application. Voiding the payment releases the rows.
 */
export const payApplicationPaymentAllocations = sqliteTable(
  "pay_application_payment_allocations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    applicationId: text("application_id")
      .notNull()
      .references(() => projectBudgetApplications.id, { onDelete: "restrict" }),
    paymentId: text("payment_id").notNull(),
    allocationCents: integer("allocation_cents").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
    releasedBy: text("released_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("pay_application_payment_allocations_pair_unique").on(table.applicationId, table.paymentId),
    index("pay_application_payment_allocations_payment_idx").on(table.paymentId),
    index("pay_application_payment_allocations_scope_idx").on(table.organizationId, table.projectId),
    index("pay_application_payment_allocations_project_id_idx").on(table.projectId),
    index("pay_application_payment_allocations_created_by_idx").on(table.createdBy),
    index("pay_application_payment_allocations_released_by_idx").on(table.releasedBy),
    check(
      "pay_application_payment_allocations_positive_check",
      sql`typeof(${table.allocationCents}) = 'integer' AND ${table.allocationCents} BETWEEN 1 AND 9007199254740991`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "pay_application_payment_allocations_project_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.paymentId],
      foreignColumns: [payments.organizationId, payments.projectId, payments.id],
      name: "pay_application_payment_allocations_payment_scope_fk",
    }).onDelete("restrict"),
  ],
)

/**
 * Staff marks that an imported (Sage or Drive) draw was paid before Compass,
 * so it counts as settled without payment details. Undoing a mark releases
 * it with a reason; released rows stay as history (drizzle/0286).
 */
export const payApplicationPrepaidMarks = sqliteTable(
  "pay_application_prepaid_marks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    applicationId: text("application_id")
      .notNull()
      .references(() => projectBudgetApplications.id, { onDelete: "restrict" }),
    note: text("note"),
    markedBy: text("marked_by").references(() => users.id, { onDelete: "set null" }),
    markedAt: text("marked_at").notNull(),
    releasedAt: text("released_at"),
    releasedBy: text("released_by").references(() => users.id, { onDelete: "set null" }),
    releaseReason: text("release_reason"),
  },
  (table) => [
    uniqueIndex("pay_application_prepaid_marks_active_unique").on(table.applicationId).where(sql`${table.releasedAt} IS NULL`),
    index("pay_application_prepaid_marks_application_idx").on(table.applicationId),
    index("pay_application_prepaid_marks_scope_idx").on(table.organizationId, table.projectId),
    index("pay_application_prepaid_marks_project_id_idx").on(table.projectId),
    index("pay_application_prepaid_marks_marked_by_idx").on(table.markedBy),
    index("pay_application_prepaid_marks_released_by_idx").on(table.releasedBy),
    check(
      "pay_application_prepaid_marks_release_check",
      sql`(${table.releasedAt} IS NULL AND ${table.releaseReason} IS NULL) OR (${table.releasedAt} IS NOT NULL AND ${table.releaseReason} IS NOT NULL AND length(trim(${table.releaseReason})) > 0)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: "pay_application_prepaid_marks_project_scope_fk",
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
    index("invoice_credit_allocations_project_id_idx").on(table.projectId),
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
export type PayApplicationPaymentAllocation = typeof payApplicationPaymentAllocations.$inferSelect
export type InvoiceCreditAllocation = typeof invoiceCreditAllocations.$inferSelect
export type NewInvoiceCreditAllocation = typeof invoiceCreditAllocations.$inferInsert
