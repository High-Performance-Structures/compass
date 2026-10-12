import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { dailyLogs, organizations, projects, users } from "./schema"

/**
 * One block of internal work: who, when, which duty (a cost code from the
 * company's duty list), how long. An entry may categorize an existing daily
 * log; the log itself is left as it was.
 */
export const internalDutyEntries = sqliteTable(
  "internal_duty_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entryDate: text("entry_date").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    dutyCode: text("duty_code").notNull(),
    dutyLabel: text("duty_label").notNull(),
    hours: real("hours"),
    notes: text("notes"),
    /** The client job this work was for, when there is one (e.g. coding its invoices). */
    relatedProjectId: text("related_project_id").references(() => projects.id, { onDelete: "set null" }),
    /** The daily log this entry categorizes, for logs written before the duty log existed. */
    dailyLogId: text("daily_log_id").references(() => dailyLogs.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectDateIdx: index("internal_duty_entries_project_date_idx").on(table.projectId, table.entryDate),
    dailyLogIdx: uniqueIndex("internal_duty_entries_daily_log_idx").on(table.dailyLogId),
  }),
)

export type InternalDutyEntry = typeof internalDutyEntries.$inferSelect

export const RECURRING_DUTY_CADENCES = ["monthly", "quarterly", "yearly"] as const

/**
 * Work that comes around on a schedule (a bank reconciliation each month,
 * sales tax filings). Each period's work is due on `dueDay` of the month
 * after the period ends.
 */
export const recurringDuties = sqliteTable(
  "recurring_duties",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** The bank or card account, for reconciliations. */
    accountName: text("account_name"),
    cadence: text("cadence", { enum: RECURRING_DUTY_CADENCES }).notNull().default("monthly"),
    dueDay: integer("due_day").notNull().default(15),
    /** The duty its time is logged under, e.g. 502 Bank Reconciliations. */
    dutyCode: text("duty_code"),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("recurring_duties_project_idx").on(table.projectId, table.sortOrder),
  }),
)

/** One period of a recurring duty marked done. */
export const recurringDutyCompletions = sqliteTable(
  "recurring_duty_completions",
  {
    id: text("id").primaryKey(),
    recurringDutyId: text("recurring_duty_id")
      .notNull()
      .references(() => recurringDuties.id, { onDelete: "cascade" }),
    /** "2026-05", "2026-Q2" or "2026". */
    period: text("period").notNull(),
    completedOn: text("completed_on").notNull(),
    completedBy: text("completed_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** The duty log entry created for its hours, if any. */
    dutyEntryId: text("duty_entry_id").references(() => internalDutyEntries.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    periodIdx: uniqueIndex("recurring_duty_completions_period_idx").on(table.recurringDutyId, table.period),
  }),
)

export type RecurringDuty = typeof recurringDuties.$inferSelect
export type RecurringDutyCompletion = typeof recurringDutyCompletions.$inferSelect
