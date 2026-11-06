import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { organizations } from "./schema"
import { RECORD_STATUS_COLORS, RECORD_STATUS_GROUPS, RECORD_STATUS_TYPES } from "../lib/domain/record-statuses/statuses"

/**
 * A company's status options for one record type (Settings › Statuses).
 * Built-in rows customize a status Compass code depends on (its key never
 * changes, only its label, color, group, order and visibility); other rows
 * are statuses the company added. With no rows a record type uses its code
 * defaults (src/lib/domain/record-statuses/registry.ts). Written only by
 * src/lib/domain/record-statuses/store.ts.
 */
export const organizationRecordStatuses = sqliteTable(
  "organization_record_statuses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recordType: text("record_type", { enum: RECORD_STATUS_TYPES }).notNull(),
    /** The value stored on records. Stable: renaming a status changes only its label. */
    statusKey: text("status_key").notNull(),
    label: text("label").notNull(),
    color: text("color", { enum: RECORD_STATUS_COLORS }).notNull().default("gray"),
    /** What the status counts as; "Open" on filter buttons is the open group. */
    statusGroup: text("status_group", { enum: RECORD_STATUS_GROUPS }).notNull().default("open"),
    sortOrder: integer("sort_order").notNull().default(0),
    showAsButton: integer("show_as_button", { mode: "boolean" }).notNull().default(true),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_record_statuses_org_type_key_unique").on(
      table.organizationId,
      table.recordType,
      table.statusKey,
    ),
  ],
)

export type OrganizationRecordStatus = typeof organizationRecordStatuses.$inferSelect
