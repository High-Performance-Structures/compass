/*
 * Project schedules: schedule tasks, links between them, dependencies,
 * workday exceptions, baselines, publications, phase options, saved schedule
 * views and per-user schedule preferences.
 * Written by: src/lib/domain/schedule/.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  DEPENDENCY_TYPES,
  SCHEDULE_TASK_STATUSES,
  STORED_SCHEDULE_LINK_TYPES,
  WORKDAY_EXCEPTION_TYPES,
} from "../lib/domain/schedule/statuses"
import { SAVED_VIEW_VISIBILITIES } from "../lib/domain/settings/statuses"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

export const userSchedulePreferences = sqliteTable("user_schedule_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  ganttScrollMode: text("gantt_scroll_mode").notNull().default("default"),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleSavedViews = sqliteTable(
  "schedule_saved_views",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility", { enum: SAVED_VIEW_VISIBILITIES }).notNull().default("personal"),
    definition: text("definition").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("schedule_saved_views_org_idx").on(table.organizationId),
    index("schedule_saved_views_owner_idx").on(table.ownerUserId),
    uniqueIndex("schedule_saved_views_owner_name_unique").on(
      table.ownerUserId,
      table.name
    ),
  ]
)

export type ScheduleSavedView = typeof scheduleSavedViews.$inferSelect

export type NewScheduleSavedView = typeof scheduleSavedViews.$inferInsert

export const schedulePhaseOptions = sqliteTable(
  "schedule_phase_options",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("schedule_phase_options_org_name_unique").on(
      table.organizationId,
      table.normalizedName
    ),
    index("schedule_phase_options_org_name_idx").on(
      table.organizationId,
      table.name
    ),
  ]
)

export type SchedulePhaseOption = typeof schedulePhaseOptions.$inferSelect

export type NewSchedulePhaseOption = typeof schedulePhaseOptions.$inferInsert

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes"),
  startDate: text("start_date").notNull(),
  workdays: integer("workdays").notNull(),
  endDateCalculated: text("end_date_calculated").notNull(),
  // Optional "HH:MM" times; both null means an all-day item.
  startTime: text("start_time"),
  endTime: text("end_time"),
  phase: text("phase").notNull(),
  displayColor: text("display_color").notNull().default("blue"),
  status: text("status", { enum: SCHEDULE_TASK_STATUSES }).notNull().default("PENDING"),
  isCriticalPath: integer("is_critical_path", { mode: "boolean" })
    .notNull()
    .default(false),
  isMilestone: integer("is_milestone", { mode: "boolean" })
    .notNull()
    .default(false),
  percentComplete: integer("percent_complete").notNull().default(0),
  assignedTo: text("assigned_to"),
  assignedUserId: text("assigned_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(true),
  subVendorVisible: integer("sub_vendor_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  confirmationRequired: integer("confirmation_required", { mode: "boolean" })
    .notNull()
    .default(false),
  confirmationStatus: text("confirmation_status")
    .notNull()
    .default("not_requested"),
  confirmationRequestedAt: text("confirmation_requested_at"),
  confirmationRespondedAt: text("confirmation_responded_at"),
  reminderSentAt: text("reminder_sent_at"),
  proposedStartDate: text("proposed_start_date"),
  proposedWorkdays: integer("proposed_workdays"),
  proposalNote: text("proposal_note"),
  proposalSubmittedAt: text("proposal_submitted_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("schedule_tasks_project_start_idx").on(table.projectId, table.startDate),
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("schedule_tasks_assigned_user_idx").on(table.assignedUserId),
  ])

export const scheduleTaskLinks = sqliteTable(
  "schedule_task_links",
  {
    id: text("id").primaryKey(),
    scheduleTaskId: text("schedule_task_id")
      .notNull()
      .references(() => scheduleTasks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type", { enum: STORED_SCHEDULE_LINK_TYPES }).notNull(),
    resourceId: text("resource_id"),
    label: text("label").notNull(),
    href: text("href").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_schedule_task_links_task").on(table.scheduleTaskId),
    index("idx_schedule_task_links_project_type").on(
      table.projectId,
      table.resourceType
    ),
  ]
)

export const taskDependencies = sqliteTable("task_dependencies", {
  id: text("id").primaryKey(),
  predecessorId: text("predecessor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  successorId: text("successor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  type: text("type", { enum: DEPENDENCY_TYPES }).notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
},
  (table) => [
    index("task_dependencies_successor_id_idx").on(table.successorId),
    index("task_dependencies_predecessor_id_idx").on(table.predecessorId),
  ])

export const workdayExceptions = sqliteTable("workday_exceptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: text("type", { enum: WORKDAY_EXCEPTION_TYPES }).notNull().default("non_working"),
  category: text("category").notNull().default("company_holiday"),
  recurrence: text("recurrence").notNull().default("one_time"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    index("workday_exceptions_project_id_idx").on(table.projectId),
  ])

export const scheduleBaselines = sqliteTable("schedule_baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("schedule_baselines_project_id_idx").on(table.projectId),
  ])

export const schedulePublications = sqliteTable(
  "schedule_publications",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotData: text("snapshot_data").notNull(),
    changeReason: text("change_reason").notNull(),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: text("published_at").notNull(),
  },
  (table) => [
    index("idx_schedule_publications_project_published").on(
      table.projectId,
      table.publishedAt
    ),
  ]
)

export type ScheduleTask = typeof scheduleTasks.$inferSelect

export type NewScheduleTask = typeof scheduleTasks.$inferInsert

export type TaskDependency = typeof taskDependencies.$inferSelect

export type NewTaskDependency = typeof taskDependencies.$inferInsert

export type WorkdayException = typeof workdayExceptions.$inferSelect

export type NewWorkdayException = typeof workdayExceptions.$inferInsert

export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect

export type NewScheduleBaseline = typeof scheduleBaselines.$inferInsert

export type SchedulePublication = typeof schedulePublications.$inferSelect

export type NewSchedulePublication = typeof schedulePublications.$inferInsert
