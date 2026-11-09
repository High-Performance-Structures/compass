/*
 * Company settings and per-person preferences: organization feature settings
 * (everything under Settings, one JSON value per group), saved views and
 * their defaults, project saved views, list sheet settings and column
 * preferences, view preferences, and Print Preview snapshots.
 * Written by: src/lib/domain/settings/ and src/app/actions/feature-settings.ts.
 */

import {
  index,
  sqliteTable,
  text,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { LIST_SHEET_SORT_DIRECTIONS, SAVED_VIEW_SCOPES, SAVED_VIEW_VISIBILITIES } from "../lib/domain/settings/statuses"
import { organizations, users } from "./schema-identity"

/**
 * Per-user view settings such as a list's custom order or column sort,
 * keyed by view (for example "role-dashboard:project_manager"). Value is JSON.
 */
export const userViewPreferences = sqliteTable(
  "user_view_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewKey: text("view_key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.viewKey] })]
)

/**
 * Company-editable settings for a feature (thresholds, timings, defaults),
 * one JSON value per feature key. Each key is registered with its defaults
 * and validation in lib/feature-settings.
 */
export const organizationFeatureSettings = sqliteTable(
  "organization_feature_settings",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.featureKey] })]
)

export const projectSavedViews = sqliteTable(
  "project_saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility", { enum: SAVED_VIEW_VISIBILITIES }).notNull().default("personal"),
    definition: text("definition").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_saved_views_org_idx").on(table.organizationId),
    uniqueIndex("project_saved_views_owner_org_name_unique").on(table.ownerUserId, table.organizationId, table.name),
  ],
)

/**
 * Named filter views for every screen (migration 0282). Replaces
 * project_saved_views and schedule_saved_views, which keep their rows and are
 * dual-written by domain/settings/store.ts until reads move here for good.
 */
export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: SAVED_VIEW_SCOPES }).notNull(),
    name: text("name").notNull(),
    visibility: text("visibility", { enum: SAVED_VIEW_VISIBILITIES }).notNull().default("personal"),
    // json: filter definition, validated per scope by the caller's zod schema
    definition: text("definition").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("saved_views_org_owner_scope_name_unique").on(table.organizationId, table.ownerUserId, table.scope, table.name),
    index("saved_views_org_scope_visibility_idx").on(table.organizationId, table.scope, table.visibility),
    index("saved_views_owner_idx").on(table.ownerUserId),
  ],
)

/**
 * A person's default view for one screen in one organization: either a saved
 * view (view_id) or an unnamed filter snapshot (inline_definition).
 */
export const savedViewDefaults = sqliteTable(
  "saved_view_defaults",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: SAVED_VIEW_SCOPES }).notNull(),
    viewId: text("view_id").references(() => savedViews.id, { onDelete: "set null" }),
    // json: snapshot of the default filters when they are not a named view
    inlineDefinition: text("inline_definition"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.organizationId, table.scope] }),
    index("saved_view_defaults_org_idx").on(table.organizationId),
    index("saved_view_defaults_view_idx").on(table.viewId),
  ],
)

/**
 * A company's layout for one list sheet (Settings > Lists): which columns
 * show and in what order, the sort it opens with, the status filter it
 * opens on and any renamed filter buttons. Sheet keys and column ids are code constants from the list
 * sheet registry (src/lib/domain/settings/list-sheet-registry.ts); unknown
 * ones are ignored on read.
 */
export const organizationListSheetSettings = sqliteTable(
  "organization_list_sheet_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sheetKey: text("sheet_key").notNull(),
    // json: the sheet's column layout ([{ id, visible }] in display order), validated by listSheetColumnsSchema
    columns: text("columns").notNull(),
    sortColumn: text("sort_column"),
    sortDirection: text("sort_direction", { enum: LIST_SHEET_SORT_DIRECTIONS }),
    startFilter: text("start_filter"),
    // json: renamed filter buttons ({ [filterValue]: name }), validated by listSheetFilterLabelsSchema
    filterLabels: text("filter_labels"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("organization_list_sheet_settings_org_sheet_unique").on(table.organizationId, table.sheetKey),
  ],
)

/**
 * One person's own column choices on one list sheet (the Columns button):
 * columns they hid or showed over the company layout. Columns they never
 * touched follow the company setting, so new columns appear on their own.
 */
export const userListSheetColumnPreferences = sqliteTable(
  "user_list_sheet_column_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sheetKey: text("sheet_key").notNull(),
    // json: column ids (registry code constants) this person hid, validated by listSheetColumnIdsSchema
    hiddenColumnIds: text("hidden_column_ids").notNull().default("[]"),
    // json: column ids (registry code constants) this person showed though the company hides them
    shownColumnIds: text("shown_column_ids").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_list_sheet_column_preferences_user_org_sheet_unique").on(table.userId, table.organizationId, table.sheetKey),
    index("user_list_sheet_column_preferences_org_sheet_idx").on(table.organizationId, table.sheetKey),
  ],
)

// Print Preview snapshots of documents assembled in the browser; see
// src/lib/print/snapshots.ts. Only the creator can open one.
export const printSnapshots = sqliteTable(
  "print_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: text("project_id"),
    title: text("title").notNull(),
    documentNumber: text("document_number"),
    html: text("html").notNull(),
    kind: text("kind").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("print_snapshots_user_idx").on(table.userId, table.createdAt),
    index("print_snapshots_expires_idx").on(table.expiresAt),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("print_snapshots_project_id_idx").on(table.projectId),
  ]
)
