import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
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
