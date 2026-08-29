import { relations } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { organizations, projectContacts, projects, scheduleTasks, users } from "./schema"

/**
 * A source-record participant is the authorization boundary for an imported
 * person.  The source identity is kept separate from Compass contacts/users so
 * an unresolved or conflicting import cannot accidentally become actionable.
 */
export const projectSourceRecordParticipants = sqliteTable(
  "project_source_record_participants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceRecordType: text("source_record_type").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    sourceParticipantId: text("source_participant_id").notNull(),
    sourceContactId: text("source_contact_id"),
    sourceContactName: text("source_contact_name"),
    sourceContactEmail: text("source_contact_email"),
    sourceCompany: text("source_company"),
    participantRole: text("participant_role").notNull(),
    capabilitiesJson: text("capabilities_json").notNull().default("[]"),
    audience: text("audience").notNull().default("external"),
    projectContactId: text("project_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" },
    ),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    identityStatus: text("identity_status").notNull().default("unmatched"),
    membershipStatus: text("membership_status").notNull().default("pending"),
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_source_record_participants_identity_unique").on(
      table.organizationId,
      table.projectId,
      table.sourceRecordType,
      table.sourceRecordId,
      table.sourceParticipantId,
    ),
    index("project_source_record_participants_record_idx").on(
      table.organizationId,
      table.projectId,
      table.sourceRecordType,
      table.sourceRecordId,
    ),
    index("project_source_record_participants_project_contact_idx").on(
      table.projectContactId,
    ),
    index("project_source_record_participants_user_idx").on(table.userId),
    index("project_source_record_participants_review_idx").on(
      table.reviewStatus,
      table.identityStatus,
      table.membershipStatus,
      table.active,
    ),
  ],
)

/** Multiple reviewed participants may be assigned to one schedule task. */
export const scheduleTaskAssignees = sqliteTable(
  "schedule_task_assignees",
  {
    id: text("id").primaryKey(),
    scheduleTaskId: text("schedule_task_id")
      .notNull()
      .references(() => scheduleTasks.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => projectSourceRecordParticipants.id, {
        onDelete: "cascade",
      }),
    // Denormalized target keys make the assignment boundary explicit and let
    // callers address a user/contact without resolving source metadata first.
    // participant_id remains required for imported-source provenance.
    assignedUserId: text("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectContactId: text("project_contact_id").references(
      () => projectContacts.id,
      { onDelete: "set null" },
    ),
    participantRole: text("participant_role").notNull().default("assignee"),
    // Snapshot the source schedule so an assignee response cannot rewrite it.
    sourceStartDate: text("source_start_date").notNull(),
    sourceWorkdays: integer("source_workdays").notNull(),
    sourceEndDate: text("source_end_date").notNull(),
    responseStatus: text("response_status").notNull().default("pending"),
    dateResponseStatus: text("date_response_status")
      .notNull()
      .default("pending"),
    durationResponseStatus: text("duration_response_status")
      .notNull()
      .default("pending"),
    proposedStartDate: text("proposed_start_date"),
    proposedWorkdays: integer("proposed_workdays"),
    proposedEndDate: text("proposed_end_date"),
    responseMessage: text("response_message"),
    respondedAt: text("responded_at"),
    respondedByUserId: text("responded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    responseSource: text("response_source"),
    assignedAt: text("assigned_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("schedule_task_assignees_task_participant_unique").on(
      table.scheduleTaskId,
      table.participantId,
    ),
    uniqueIndex("schedule_task_assignees_task_user_unique").on(
      table.scheduleTaskId,
      table.assignedUserId,
    ),
    uniqueIndex("schedule_task_assignees_task_contact_unique").on(
      table.scheduleTaskId,
      table.projectContactId,
    ),
    index("schedule_task_assignees_participant_idx").on(table.participantId),
  ],
)

export const projectSourceRecordParticipantsRelations = relations(
  projectSourceRecordParticipants,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [projectSourceRecordParticipants.organizationId],
      references: [organizations.id],
    }),
    project: one(projects, {
      fields: [projectSourceRecordParticipants.projectId],
      references: [projects.id],
    }),
    projectContact: one(projectContacts, {
      fields: [projectSourceRecordParticipants.projectContactId],
      references: [projectContacts.id],
    }),
    user: one(users, {
      fields: [projectSourceRecordParticipants.userId],
      references: [users.id],
    }),
    scheduleTaskAssignees: many(scheduleTaskAssignees),
  }),
)

export const scheduleTaskAssigneesRelations = relations(
  scheduleTaskAssignees,
  ({ one }) => ({
    scheduleTask: one(scheduleTasks, {
      fields: [scheduleTaskAssignees.scheduleTaskId],
      references: [scheduleTasks.id],
    }),
    participant: one(projectSourceRecordParticipants, {
      fields: [scheduleTaskAssignees.participantId],
      references: [projectSourceRecordParticipants.id],
    }),
  }),
)

export type ProjectSourceRecordParticipant =
  typeof projectSourceRecordParticipants.$inferSelect
export type NewProjectSourceRecordParticipant =
  typeof projectSourceRecordParticipants.$inferInsert
export type ScheduleTaskAssignee = typeof scheduleTaskAssignees.$inferSelect
export type NewScheduleTaskAssignee = typeof scheduleTaskAssignees.$inferInsert
