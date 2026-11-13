/*
 * Finish selections on a project and the rooms they belong to.
 * Written by: src/lib/domain/selections/.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core"

import { PROJECT_SELECTION_STATUSES, SELECTION_REPLACEMENT_REASONS } from "../lib/domain/selections/statuses"
import { projectOperations } from "./schema-operations"
import { projects } from "./schema-projects"

export const projectFinishSelections = sqliteTable("project_finish_selections", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  sourceWorkbookId: text("source_workbook_id"),
  sourceSheetName: text("source_sheet_name"),
  roomName: text("room_name").notNull(),
  roomType: text("room_type"),
  category: text("category").notNull().default("Uncategorized"),
  name: text("name").notNull(),
  description: text("description"),
  quantity: real("quantity"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  colorFinish: text("color_finish"),
  choiceOptionsJson: text("choice_options_json"),
  parentSelectionId: text("parent_selection_id"),
  parentChoiceValue: text("parent_choice_value"),
  selectionLevel: integer("selection_level").notNull().default(0),
  supplierName: text("supplier_name"),
  productUrl: text("product_url"),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  status: text("status", { enum: PROJECT_SELECTION_STATUSES }).notNull().default("needed"),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  ownerApproved: integer("owner_approved", { mode: "boolean" })
    .notNull()
    .default(false),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  rfqOperationId: text("rfq_operation_id").references(() => projectOperations.id, {
    onDelete: "set null",
  }),
  purchaseOrderOperationId: text("purchase_order_operation_id").references(
    () => projectOperations.id,
    { onDelete: "set null" }
  ),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  // The company selection round (Settings > Selections) it belongs to; a key into those settings. Null: no round. (0313)
  roundKey: text("round_key"),
  // The ordered or installed selection this one replaces; that one stays on record, locked. One replacement each. (0321)
  replacesSelectionId: text("replaces_selection_id").references((): AnySQLiteColumn => projectFinishSelections.id, { onDelete: "set null" }),
  replacementReason: text("replacement_reason", { enum: SELECTION_REPLACEMENT_REASONS }),
  // When staff marked it Unavailable from Ordered; purchase orders linked before then no longer move it. (0321)
  procurementReleasedAt: text("procurement_released_at"),
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0044_project_finish_selections.sql.
    index("idx_project_finish_selections_project").on(table.projectId),
    // Declared from drizzle/0044_project_finish_selections.sql.
    index("idx_project_finish_selections_room").on(table.projectId, table.roomName),
    // Declared from drizzle/0044_project_finish_selections.sql.
    index("idx_project_finish_selections_status").on(table.projectId, table.status),
    // Declared from drizzle/0044_project_finish_selections.sql.
    index("idx_project_finish_selections_cost_code").on(table.projectId, table.costCode),
    // Declared from drizzle/0044_project_finish_selections.sql.
    index("idx_project_finish_selections_source").on(table.sourceSystem, table.sourceRecordId),
    // Declared from drizzle/0090_finish_selection_hierarchy.sql.
    index("idx_finish_selections_parent").on(table.projectId, table.parentSelectionId),
    index("project_finish_selections_purchase_order_operation_id_idx").on(table.purchaseOrderOperationId),
    index("project_finish_selections_rfq_operation_id_idx").on(table.rfqOperationId),
    index("project_finish_selections_round_idx").on(table.projectId, table.roundKey),
    uniqueIndex("project_finish_selections_replaces_unique").on(table.replacesSelectionId),
  ])

export const projectFinishSelectionRooms = sqliteTable("project_finish_selection_rooms", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceWorkbookId: text("source_workbook_id"),
  sourceSheetId: text("source_sheet_id"),
  sourceSheetName: text("source_sheet_name"),
  roomName: text("room_name").notNull(),
  roomType: text("room_type"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0046_project_finish_selection_rooms.sql.
    index("idx_project_finish_selection_rooms_project").on(table.projectId),
    // Declared from drizzle/0046_project_finish_selection_rooms.sql.
    index("idx_project_finish_selection_rooms_source").on(table.sourceSystem, table.sourceWorkbookId, table.sourceSheetId),
  ])

export type ProjectFinishSelection =
  typeof projectFinishSelections.$inferSelect

export type NewProjectFinishSelection =
  typeof projectFinishSelections.$inferInsert

export type ProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferSelect

export type NewProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferInsert
