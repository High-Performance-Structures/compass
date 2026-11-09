/*
 * Client relationship records on a project: follow-ups and their reminders,
 * notes, and logged interactions (calls, meetings, emails).
 * Written by: src/lib/domain/crm/.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"

import { projectContacts } from "./schema-contacts"
import { dailyLogs } from "./schema-field"
import { organizations, users } from "./schema-identity"
import { projects } from "./schema-projects"

export const projectFollowUps = sqliteTable("project_follow_ups", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  nextFollowUpAt: text("next_follow_up_at").notNull(),
  ownerUserId: text("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    index("project_follow_ups_owner_user_id_idx").on(table.ownerUserId),
    index("project_follow_ups_organization_id_idx").on(table.organizationId),
  ])

/** When a job's follow-up owner was last reminded of an overdue stretch. */
export const projectFollowUpReminders = sqliteTable("project_follow_up_reminders", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  remindedAt: text("reminded_at").notNull(),
},
  (table) => [
    index("project_follow_up_reminders_organization_id_idx").on(table.organizationId),
  ])

export const projectNotes = sqliteTable(
  "project_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("project_notes_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
)

export const projectInteractions = sqliteTable(
  "project_interactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectContactId: text("project_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" },
    ),
    interactionType: text("interaction_type").notNull(),
    direction: text("direction").notNull(),
    source: text("source").notNull().default("manual"),
    qualifiesForClientTouch: integer("qualifies_for_client_touch", {
      mode: "boolean",
    }).notNull().default(false),
    summary: text("summary").notNull(),
    occurredAt: text("occurred_at").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    /** The daily log this contact was recorded on, if any. */
    dailyLogId: text("daily_log_id").references(() => dailyLogs.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("project_interactions_project_occurred_idx").on(
      table.projectId,
      table.occurredAt,
    ),
    index("project_interactions_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    index("project_interactions_project_contact_id_idx").on(table.projectContactId),
    index("project_interactions_daily_log_id_idx").on(table.dailyLogId),
  ],
)
