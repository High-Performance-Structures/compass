import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { organizations, users } from "./schema"

export const RATE_BOOK_CATEGORIES = [
  "labor",
  "machine",
  "delivery",
  "fuel",
  "travel",
  "lodging",
  "rental",
  "material",
  "subcontract",
  "other",
] as const
export type RateBookCategory = (typeof RATE_BOOK_CATEGORIES)[number]

/** Accepted rates estimators pick from. Edits bump `version` and write history. */
export const rateBookEntries = sqliteTable(
  "rate_book_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", { enum: RATE_BOOK_CATEGORIES }).notNull(),
    unit: text("unit").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    markupBasisPoints: integer("markup_basis_points").notNull().default(0),
    divisionCode: text("division_code"),
    divisionName: text("division_name"),
    costCode: text("cost_code"),
    costCodeName: text("cost_code_name"),
    fuelType: text("fuel_type", { enum: ["none", "diesel", "regular"] }).notNull().default("none"),
    fuelGallonsPerUnit: real("fuel_gallons_per_unit"),
    notes: text("notes"),
    status: text("status", { enum: ["active", "retired"] }).notNull().default("active"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("rate_book_entries_org_status_idx").on(table.organizationId, table.status, table.category)],
)

/** One row per saved version of an entry, so rate changes can be traced. */
export const rateBookEntryHistory = sqliteTable(
  "rate_book_entry_history",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => rateBookEntries.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    changeNote: text("change_note"),
    changedAt: text("changed_at").notNull(),
    changedBy: text("changed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("rate_book_entry_history_entry_idx").on(table.entryId, table.version)],
)
