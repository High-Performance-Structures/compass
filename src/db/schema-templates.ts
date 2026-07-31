import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, projects, scheduleTasks, users } from "./schema"

export const projectTemplates = sqliteTable(
  "project_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull().default("compass"),
    sourceKey: text("source_key").notNull(),
    sourceTemplateId: text("source_template_id"),
    sourceUrl: text("source_url"),
    name: text("name").notNull(),
    description: text("description"),
    templateKind: text("template_kind").notNull().default("assembly"),
    departmentCode: text("department_code"),
    tradeCategory: text("trade_category"),
    lifecycleStatus: text("lifecycle_status").notNull().default("draft"),
    reviewStatus: text("review_status").notNull().default("inventory_only"),
    currentVersionNumber: integer("current_version_number"),
    sourceMetadataJson: text("source_metadata_json"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_templates_org_source_key_unique").on(
      table.organizationId,
      table.sourceSystem,
      table.sourceKey
    ),
    index("project_templates_org_status_idx").on(
      table.organizationId,
      table.lifecycleStatus
    ),
    index("project_templates_org_trade_idx").on(
      table.organizationId,
      table.tradeCategory
    ),
  ]
)

export const projectTemplateVersions = sqliteTable(
  "project_template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => projectTemplates.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    sourceFingerprint: text("source_fingerprint"),
    sourceCapturedAt: text("source_captured_at"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_template_versions_template_number_unique").on(
      table.templateId,
      table.versionNumber
    ),
    index("project_template_versions_status_idx").on(
      table.templateId,
      table.status
    ),
  ]
)

export const projectTemplateModules = sqliteTable(
  "project_template_modules",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: "cascade" }),
    moduleType: text("module_type").notNull(),
    sourceItemCount: integer("source_item_count").notNull().default(0),
    normalizationStatus: text("normalization_status")
      .notNull()
      .default("inventory_only"),
    sourcePayloadJson: text("source_payload_json"),
  },
  (table) => [
    uniqueIndex("project_template_modules_version_type_unique").on(
      table.versionId,
      table.moduleType
    ),
  ]
)

export const scheduleTemplateItems = sqliteTable(
  "schedule_template_items",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: "cascade" }),
    sourceItemId: text("source_item_id"),
    itemKey: text("item_key").notNull(),
    title: text("title").notNull(),
    startOffsetWorkdays: integer("start_offset_workdays").notNull().default(0),
    workdays: integer("workdays").notNull().default(1),
    phase: text("phase").notNull().default("Unassigned / General"),
    displayColor: text("display_color").notNull().default("blue"),
    isMilestone: integer("is_milestone", { mode: "boolean" })
      .notNull()
      .default(false),
    assigneePlaceholder: text("assignee_placeholder"),
    ownerVisible: integer("owner_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    subVendorVisible: integer("sub_vendor_visible", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("schedule_template_items_version_key_unique").on(
      table.versionId,
      table.itemKey
    ),
    index("schedule_template_items_version_order_idx").on(
      table.versionId,
      table.sortOrder
    ),
  ]
)

export const scheduleTemplateDependencies = sqliteTable(
  "schedule_template_dependencies",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: "cascade" }),
    predecessorItemId: text("predecessor_item_id")
      .notNull()
      .references(() => scheduleTemplateItems.id, { onDelete: "cascade" }),
    successorItemId: text("successor_item_id")
      .notNull()
      .references(() => scheduleTemplateItems.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("FS"),
    lagDays: integer("lag_days").notNull().default(0),
  },
  (table) => [
    uniqueIndex("schedule_template_dependencies_edge_unique").on(
      table.versionId,
      table.predecessorItemId,
      table.successorItemId,
      table.type
    ),
  ]
)

export const projectTemplateApplications = sqliteTable(
  "project_template_applications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => projectTemplates.id, { onDelete: "restrict" }),
    versionId: text("version_id")
      .notNull()
      .references(() => projectTemplateVersions.id, { onDelete: "restrict" }),
    anchorDate: text("anchor_date").notNull(),
    status: text("status").notNull().default("applying"),
    appliedBy: text("applied_by").references(() => users.id, {
      onDelete: "set null",
    }),
    itemCount: integer("item_count").notNull().default(0),
    dependencyCount: integer("dependency_count").notNull().default(0),
    optionsJson: text("options_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("project_template_applications_project_idx").on(
      table.projectId,
      table.createdAt
    ),
    index("project_template_applications_template_idx").on(
      table.templateId,
      table.status
    ),
  ]
)

export const projectTemplateApplicationItems = sqliteTable(
  "project_template_application_items",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => projectTemplateApplications.id, {
        onDelete: "cascade",
      }),
    templateItemId: text("template_item_id")
      .notNull()
      .references(() => scheduleTemplateItems.id, { onDelete: "restrict" }),
    scheduleTaskId: text("schedule_task_id")
      .notNull()
      .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("project_template_application_items_task_unique").on(
      table.scheduleTaskId
    ),
    uniqueIndex("project_template_application_items_source_unique").on(
      table.applicationId,
      table.templateItemId
    ),
  ]
)

export type ProjectTemplate = typeof projectTemplates.$inferSelect
export type ProjectTemplateVersion = typeof projectTemplateVersions.$inferSelect
export type ScheduleTemplateItem = typeof scheduleTemplateItems.$inferSelect
export type ScheduleTemplateDependency =
  typeof scheduleTemplateDependencies.$inferSelect
