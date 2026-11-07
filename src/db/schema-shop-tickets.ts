import { sql } from "drizzle-orm"
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projectBudgetApplications, projectBudgetLines, projects, users } from "./schema"
import {
  PAY_APPLICATION_SHOP_TICKET_IMPORT_MODES,
  SHOP_TICKET_RATE_KINDS,
  SHOP_TICKET_STATUSES,
  type ShopTicketStatus,
  type ShopTicketRateKind,
} from "../lib/domain/operations/statuses"
import { SAGE_LABOR_REQUEST_STATUSES, type SageLaborRequestStatus } from "../lib/domain/sage-bridge/statuses"
export type { SageLaborRequestStatus }
export type { ShopTicketStatus, ShopTicketRateKind }

/**
 * A shop ticket bills a project for the company's own labor and machine hours
 * at the set rates from the rate book. Issued tickets keep their number for
 * good; voiding marks them void instead of deleting them.
 */
export const shopTickets = sqliteTable(
  "shop_tickets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Sequence number within the company; printed with the prefix, e.g. GSL-176. */
    sequenceNumber: integer("sequence_number").notNull(),
    ticketNumber: text("ticket_number").notNull(),
    status: text("status", { enum: SHOP_TICKET_STATUSES }).notNull().default("draft"),
    ticketDate: text("ticket_date").notNull(),
    laborFrom: text("labor_from"),
    laborTo: text("labor_to"),
    /** The pay application this ticket is billed on. */
    payApplicationNumber: integer("pay_application_number"),
    /** First day of the billing month, YYYY-MM-01. */
    payApplicationMonth: text("pay_application_month"),
    budgetApplicationId: text("budget_application_id").references(() => projectBudgetApplications.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    totalCents: integer("total_cents").notNull().default(0),
    /** Set when someone issued the ticket with cost codes outside the project budget. */
    budgetReviewedBy: text("budget_reviewed_by").references(() => users.id, { onDelete: "set null" }),
    budgetReviewedAt: text("budget_reviewed_at"),
    issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
    issuedAt: text("issued_at"),
    voidedBy: text("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    numberIdx: uniqueIndex("shop_tickets_org_sequence_idx").on(table.organizationId, table.sequenceNumber),
    projectIdx: index("shop_tickets_project_idx").on(table.projectId, table.status),
    shopTicketsBudgetApplicationIdIdx: index("shop_tickets_budget_application_id_idx").on(table.budgetApplicationId),
  }),
)

export const shopTicketLines = sqliteTable(
  "shop_ticket_lines",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => shopTickets.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    costCode: text("cost_code").notNull(),
    description: text("description").notNull(),
    rateKind: text("rate_kind", { enum: SHOP_TICKET_RATE_KINDS }).notNull(),
    hours: real("hours").notNull(),
    /** The set rate copied from the rate book when the line was saved. */
    rateCents: integer("rate_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    rateBookEntryId: text("rate_book_entry_id"),
    /** True when the project has a budget and this cost code is not in it. */
    outsideBudget: integer("outside_budget", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    ticketIdx: index("shop_ticket_lines_ticket_idx").on(table.ticketId, table.lineNumber),
    // Declared from drizzle/0278_paper_trail_sweep_indexes.sql: the paper-trail
    // sweep reads max(updated_at) per parent; this makes it one index seek.
    ticketUpdatedIdx: index("shop_ticket_lines_ticket_updated_idx").on(table.ticketId, table.updatedAt),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    rateBookEntryIdRefIdx: index("shop_ticket_lines_rate_book_entry_id_idx").on(table.rateBookEntryId),
  }),
)

/**
 * What a shop ticket contributed to an owner pay application. An "imported"
 * row is the amount added to one G703 line, so a re-import adds only the
 * difference and unlinking takes it back off. An "already_included" row has
 * no line: the ticket counts as billed on the pay application without
 * changing any amount.
 */
export const payApplicationShopTicketImports = sqliteTable(
  "pay_application_shop_ticket_imports",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => projectBudgetApplications.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => shopTickets.id, { onDelete: "cascade" }),
    budgetLineId: text("budget_line_id").references(() => projectBudgetLines.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull().default(0),
    mode: text("mode", { enum: PAY_APPLICATION_SHOP_TICKET_IMPORT_MODES }).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    lineIdx: uniqueIndex("pay_application_shop_ticket_imports_line_idx").on(table.applicationId, table.ticketId, table.budgetLineId),
    ticketMarkIdx: uniqueIndex("pay_application_shop_ticket_imports_mark_idx")
      .on(table.applicationId, table.ticketId)
      .where(sql`"budget_line_id" IS NULL`),
    ticketIdx: index("pay_application_shop_ticket_imports_ticket_idx").on(table.ticketId),
    budgetLineIdx: index("pay_application_shop_ticket_imports_budget_line_idx").on(table.budgetLineId),
    createdByIdx: index("pay_application_shop_ticket_imports_created_by_idx").on(table.createdBy),
  }),
)

/**
 * A request for a project's Sage timecard hours over a date range, picked up
 * by the read-only Sage bridge. The bridge finds the job by its Sage number,
 * or by the project number at the start of the Sage job name.
 */
export const sageLaborRequests = sqliteTable(
  "sage_labor_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectNumber: text("project_number"),
    /** Sage job record number; filled in by the bridge when it finds the job by name. */
    sageJobNumber: text("sage_job_number"),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    status: text("status", { enum: SAGE_LABOR_REQUEST_STATUSES }).notNull().default("queued"),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    lineCount: integer("line_count"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: text("requested_at").notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIdx: index("sage_labor_requests_status_idx").on(table.status, table.requestedAt),
    projectIdx: index("sage_labor_requests_project_idx").on(table.projectId, table.requestedAt),
    sageLaborRequestsOrganizationIdIdx: index("sage_labor_requests_organization_id_idx").on(table.organizationId),
  }),
)

/**
 * One Sage timecard line (hours an employee worked on a job, by cost code).
 * The id is Sage's payroll record and line number, so a refresh updates the
 * same row and claims stay attached.
 */
export const sageLaborLines = sqliteTable(
  "sage_labor_lines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sageJobNumber: text("sage_job_number").notNull(),
    workDate: text("work_date").notNull(),
    hours: real("hours").notNull(),
    /** Sage's cost code number, e.g. "3310000" for 03 31 00. */
    sageCostCode: text("sage_cost_code"),
    sageCostCodeName: text("sage_cost_code_name"),
    employeeName: text("employee_name"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => ({
    projectIdx: index("sage_labor_lines_project_idx").on(table.projectId, table.workDate),
    sageLaborLinesOrganizationIdIdx: index("sage_labor_lines_organization_id_idx").on(table.organizationId),
  }),
)

/** Sage timecard hours billed on a shop ticket; a void ticket's claims no longer count. */
export const shopTicketLaborClaims = sqliteTable(
  "shop_ticket_labor_claims",
  {
    ticketId: text("ticket_id")
      .notNull()
      .references(() => shopTickets.id, { onDelete: "cascade" }),
    laborLineId: text("labor_line_id")
      .notNull()
      .references(() => sageLaborLines.id, { onDelete: "cascade" }),
    hours: real("hours").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ticketId, table.laborLineId] }),
    lineIdx: index("shop_ticket_labor_claims_line_idx").on(table.laborLineId),
  }),
)

export type ShopTicket = typeof shopTickets.$inferSelect
export type ShopTicketLine = typeof shopTicketLines.$inferSelect
