import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { organizations, projects, users } from "./schema"
import { rateBookEntries } from "./schema-rate-book"

/**
 * A company machine (loader, excavator). Its running rate comes from its rate
 * book entry, the same rate shop tickets bill; standby and idle rates, which
 * the rate book has no place for, are kept here. `sageEquipmentNumber` ties
 * it to Sage's equipment list for syncing.
 */
export const equipmentMachines = sqliteTable(
  "equipment_machines",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sageEquipmentNumber: text("sage_equipment_number"),
    rateBookEntryId: text("rate_book_entry_id").references(() => rateBookEntries.id, { onDelete: "set null" }),
    standbyRateCents: integer("standby_rate_cents"),
    idleRateCents: integer("idle_rate_cents"),
    /** Latest hour meter reading and the day it was read. */
    hourMeter: real("hour_meter"),
    hourMeterOn: text("hour_meter_on"),
    /** Where it was last logged: a job, or a note such as "Kiowa Yard". */
    locationProjectId: text("location_project_id").references(() => projects.id, { onDelete: "set null" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("equipment_machines_org_idx").on(table.organizationId, table.active)],
)

/** A recurring service on a machine: every so many hours and/or days. */
export const equipmentServiceItems = sqliteTable(
  "equipment_service_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => equipmentMachines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    everyHours: real("every_hours"),
    everyDays: integer("every_days"),
    lastDoneHours: real("last_done_hours"),
    lastDoneOn: text("last_done_on"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("equipment_service_items_machine_idx").on(table.machineId)],
)

export const EQUIPMENT_LOG_KINDS = ["hours", "fuel", "maintenance", "repair", "other"] as const
export type EquipmentLogKind = (typeof EQUIPMENT_LOG_KINDS)[number]

export const EQUIPMENT_LOG_STATUSES = ["pending", "approved", "rejected"] as const
export type EquipmentLogStatus = (typeof EQUIPMENT_LOG_STATUSES)[number]

/**
 * One machine log entry: hours on a job, a fill-up, a service or repair, or
 * another cost. Entries wait for office approval; approved entries are what
 * later go to Sage (field report equipment lines, payable invoice equipment
 * lines). Prices are kept as they were when logged.
 */
export const equipmentLogEntries = sqliteTable(
  "equipment_log_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => equipmentMachines.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: EQUIPMENT_LOG_KINDS }).notNull(),
    entryDate: text("entry_date").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    operatorUserId: text("operator_user_id").references(() => users.id, { onDelete: "set null" }),
    operatorName: text("operator_name"),
    costCode: text("cost_code"),
    runningHours: real("running_hours"),
    standbyHours: real("standby_hours"),
    idleHours: real("idle_hours"),
    hourMeter: real("hour_meter"),
    gallons: real("gallons"),
    amountCents: integer("amount_cents"),
    vendor: text("vendor"),
    paidWith: text("paid_with"),
    serviceItemId: text("service_item_id").references(() => equipmentServiceItems.id, { onDelete: "set null" }),
    /** Our own mechanic's time on a service or repair. */
    shopHours: real("shop_hours"),
    /** Rates when logged, in cents per hour, and the hours' total. */
    runningRateCents: integer("running_rate_cents"),
    standbyRateCents: integer("standby_rate_cents"),
    idleRateCents: integer("idle_rate_cents"),
    chargeCents: integer("charge_cents"),
    notes: text("notes"),
    status: text("status", { enum: EQUIPMENT_LOG_STATUSES }).notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    /** Set by a phone so a retried sync doesn't log the entry twice. */
    clientSubmissionId: text("client_submission_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("equipment_log_entries_org_date_idx").on(table.organizationId, table.entryDate),
    index("equipment_log_entries_machine_idx").on(table.machineId, table.entryDate),
    index("equipment_log_entries_status_idx").on(table.organizationId, table.status),
    uniqueIndex("equipment_log_entries_submission_idx").on(table.clientSubmissionId),
  ],
)

export type EquipmentMachine = typeof equipmentMachines.$inferSelect
export type EquipmentServiceItem = typeof equipmentServiceItems.$inferSelect
export type EquipmentLogEntry = typeof equipmentLogEntries.$inferSelect
