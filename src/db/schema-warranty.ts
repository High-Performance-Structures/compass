import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import { organizations, projects, users } from "./schema"

export const projectWarrantyClaims = sqliteTable(
  "project_warranty_claims",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull().default("compass"),
    sourceRecordId: text("source_record_id"),
    claimNumber: text("claim_number").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    category: text("category").notNull(),
    description: text("description").notNull(),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("submitted"),
    audience: text("audience").notNull().default("owner"),
    promotionState: text("promotion_state").notNull().default("actionable"),
    claimantUserId: text("claimant_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimantName: text("claimant_name").notNull(),
    assignedUserId: text("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedName: text("assigned_name"),
    acknowledgedAt: text("acknowledged_at"),
    scheduledFor: text("scheduled_for"),
    workStartedAt: text("work_started_at"),
    resolvedAt: text("resolved_at"),
    ownerConfirmedAt: text("owner_confirmed_at"),
    resolutionSummary: text("resolution_summary"),
    internalNotes: text("internal_notes"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: text("submitted_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_warranty_claims_project_number_uq").on(
      table.projectId,
      table.claimNumber
    ),
    uniqueIndex("project_warranty_claims_source_uq").on(
      table.organizationId,
      table.sourceSystem,
      table.sourceRecordId
    ),
    index("project_warranty_claims_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt
    ),
    index("project_warranty_claims_assignee_idx").on(
      table.projectId,
      table.assignedUserId,
      table.status
    ),
  ]
)

export const projectWarrantyClaimAttachments = sqliteTable(
  "project_warranty_claim_attachments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => projectWarrantyClaims.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size").notNull().default(0),
    storageProvider: text("storage_provider").notNull().default("google_drive"),
    storageId: text("storage_id"),
    storageUrl: text("storage_url"),
    ownerVisible: integer("owner_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_warranty_claim_attachments_claim_idx").on(
      table.claimId,
      table.createdAt
    ),
    index("project_warranty_claim_attachments_project_idx").on(table.projectId),
  ]
)

export const projectWarrantyClaimEvents = sqliteTable(
  "project_warranty_claim_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => projectWarrantyClaims.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    ownerVisible: integer("owner_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_warranty_claim_events_claim_idx").on(
      table.claimId,
      table.createdAt
    ),
  ]
)

export const buildertrendWarrantyClaimStaging = sqliteTable(
  "buildertrend_warranty_claim_staging",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceRecordId: text("source_record_id").notNull(),
    sourceProjectId: text("source_project_id"),
    sourceClaimNumber: text("source_claim_number"),
    title: text("title").notNull(),
    description: text("description"),
    sourceStatus: text("source_status"),
    sourcePriority: text("source_priority"),
    sourceCreatedAt: text("source_created_at"),
    sourceUpdatedAt: text("source_updated_at"),
    sourceUrl: text("source_url"),
    rawPayloadJson: text("raw_payload_json").notNull(),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    reviewNotes: text("review_notes"),
    promotedClaimId: text("promoted_claim_id").references(
      () => projectWarrantyClaims.id,
      { onDelete: "set null" }
    ),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_warranty_staging_source_uq").on(
      table.organizationId,
      table.sourceRecordId
    ),
    index("buildertrend_warranty_staging_review_idx").on(
      table.organizationId,
      table.reviewStatus,
      table.updatedAt
    ),
    index("buildertrend_warranty_staging_project_idx").on(table.projectId),
  ]
)

export type ProjectWarrantyClaim = typeof projectWarrantyClaims.$inferSelect
export type NewProjectWarrantyClaim = typeof projectWarrantyClaims.$inferInsert
export type ProjectWarrantyClaimAttachment =
  typeof projectWarrantyClaimAttachments.$inferSelect
export type ProjectWarrantyClaimEvent =
  typeof projectWarrantyClaimEvents.$inferSelect
export type BuildertrendWarrantyClaimStaging =
  typeof buildertrendWarrantyClaimStaging.$inferSelect
