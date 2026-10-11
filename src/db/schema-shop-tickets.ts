import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projectBudgetApplications, projects, users } from "./schema"

export const SHOP_TICKET_STATUSES = ["draft", "issued", "void"] as const
export type ShopTicketStatus = (typeof SHOP_TICKET_STATUSES)[number]

export const SHOP_TICKET_RATE_KINDS = ["labor", "machine"] as const
export type ShopTicketRateKind = (typeof SHOP_TICKET_RATE_KINDS)[number]

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
  }),
)

export type ShopTicket = typeof shopTickets.$inferSelect
export type ShopTicketLine = typeof shopTicketLines.$inferSelect
