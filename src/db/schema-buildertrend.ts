import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

import {
  customers,
  organizations,
  projects,
  users,
  vendors,
} from "./schema"

// These names intentionally differ from the abandoned 0062 staging tables.
// That keeps this foundation upgrade-safe if the old migration was applied
// manually in an environment that never recorded it in the migration journal.
export const buildertrendImportRuns = sqliteTable(
  "buildertrend_staging_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runKey: text("run_key").notNull(),
    manifestFingerprint: text("manifest_fingerprint").notNull(),
    sourceMethod: text("source_method").notNull(),
    sourceLabel: text("source_label").notNull(),
    status: text("status").notNull().default("draft"),
    startedBy: text("started_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    rawArtifactDriveFileId: text("raw_artifact_drive_file_id"),
    rawArtifactDriveUrl: text("raw_artifact_drive_url"),
    sourceNotes: text("source_notes"),
    summaryJson: text("summary_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_staging_runs_org_key_unique").on(
      table.organizationId,
      table.runKey
    ),
    index("buildertrend_staging_runs_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
)

export const buildertrendSourceRecords = sqliteTable(
  "buildertrend_staging_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    requestedProjectId: text("requested_project_id"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceScope: text("source_scope").notNull().default("job"),
    sourceRecordType: text("source_record_type").notNull(),
    buildertrendJobId: text("buildertrend_job_id"),
    buildertrendLeadId: text("buildertrend_lead_id"),
    buildertrendRecordId: text("buildertrend_record_id"),
    buildertrendRecordNumber: text("buildertrend_record_number"),
    buildertrendUrl: text("buildertrend_url"),
    title: text("title").notNull(),
    recordDate: text("record_date"),
    recordStatus: text("record_status"),
    sourceStatus: text("source_status"),
    departmentCode: text("department_code"),
    clientName: text("client_name"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    amount: real("amount"),
    searchableText: text("searchable_text"),
    normalizedSummary: text("normalized_summary"),
    rawPayloadJson: text("raw_payload_json"),
    sourceArchiveDriveFolderId: text("source_archive_drive_folder_id"),
    sourceArchiveDriveFileId: text("source_archive_drive_file_id"),
    sourceArchiveDriveUrl: text("source_archive_drive_url"),
    verifiedArchiveDriveFolderId: text("verified_archive_drive_folder_id"),
    verifiedArchiveDriveFileId: text("verified_archive_drive_file_id"),
    verifiedArchiveDriveUrl: text("verified_archive_drive_url"),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    promotionStatus: text("promotion_status").notNull().default("archive_only"),
    promotedRecordType: text("promoted_record_type"),
    promotedRecordId: text("promoted_record_id"),
    sageReconciliationStatus: text("sage_reconciliation_status")
      .notNull()
      .default("not_reviewed"),
    sourceNotes: text("source_notes"),
    reviewNotes: text("review_notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_staging_records_org_key_unique").on(
      table.organizationId,
      table.sourceKey
    ),
    index("buildertrend_staging_records_project_type_idx").on(
      table.projectId,
      table.sourceRecordType
    ),
    index("buildertrend_staging_records_job_idx").on(table.buildertrendJobId),
    index("buildertrend_staging_records_lead_idx").on(table.buildertrendLeadId),
    index("buildertrend_staging_records_review_idx").on(
      table.organizationId,
      table.reviewStatus
    ),
    index("buildertrend_staging_records_promotion_idx").on(
      table.organizationId,
      table.promotionStatus
    ),
  ]
)

export const buildertrendArchiveFiles = sqliteTable(
  "buildertrend_staging_files",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    requestedSourceRecordKey: text("requested_source_record_key"),
    sourceRecordId: text("source_record_id").references(
      () => buildertrendSourceRecords.id,
      { onDelete: "restrict" }
    ),
    requestedProjectId: text("requested_project_id"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceScope: text("source_scope").notNull().default("job"),
    sourceRecordType: text("source_record_type").notNull(),
    buildertrendJobId: text("buildertrend_job_id"),
    buildertrendLeadId: text("buildertrend_lead_id"),
    buildertrendFileId: text("buildertrend_file_id"),
    buildertrendUrl: text("buildertrend_url"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    sourceDriveFolderId: text("source_drive_folder_id"),
    sourceDriveFileId: text("source_drive_file_id"),
    sourceDriveUrl: text("source_drive_url"),
    sourceThumbnailDriveFileId: text("source_thumbnail_drive_file_id"),
    sourceThumbnailUrl: text("source_thumbnail_url"),
    verifiedDriveFolderId: text("verified_drive_folder_id"),
    verifiedDriveFileId: text("verified_drive_file_id"),
    verifiedDriveUrl: text("verified_drive_url"),
    verifiedThumbnailDriveFileId: text("verified_thumbnail_drive_file_id"),
    verifiedThumbnailUrl: text("verified_thumbnail_url"),
    sourceChecksum: text("source_checksum"),
    verifiedChecksum: text("verified_checksum"),
    capturedAt: text("captured_at"),
    visibility: text("visibility").notNull().default("internal"),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    sourceMetadataJson: text("source_metadata_json"),
    reviewMetadataJson: text("review_metadata_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_staging_files_org_key_unique").on(
      table.organizationId,
      table.sourceKey
    ),
    index("buildertrend_staging_files_source_idx").on(table.sourceRecordId),
    index("buildertrend_staging_files_project_idx").on(table.projectId),
    index("buildertrend_staging_files_job_idx").on(table.buildertrendJobId),
    index("buildertrend_staging_files_review_idx").on(
      table.organizationId,
      table.reviewStatus
    ),
  ]
)

export const buildertrendAccessCandidates = sqliteTable(
  "buildertrend_staging_access_candidates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    requestedSourceRecordKey: text("requested_source_record_key"),
    sourceRecordId: text("source_record_id").references(
      () => buildertrendSourceRecords.id,
      { onDelete: "restrict" }
    ),
    requestedProjectId: text("requested_project_id"),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    buildertrendJobId: text("buildertrend_job_id"),
    buildertrendLeadId: text("buildertrend_lead_id"),
    buildertrendContactId: text("buildertrend_contact_id"),
    buildertrendAccessRole: text("buildertrend_access_role"),
    contactName: text("contact_name").notNull(),
    companyName: text("company_name"),
    email: text("email"),
    phone: text("phone"),
    proposedContactType: text("proposed_contact_type")
      .notNull()
      .default("vendor"),
    proposedProjectRole: text("proposed_project_role"),
    matchedUserId: text("matched_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    matchedCustomerId: text("matched_customer_id").references(
      () => customers.id,
      { onDelete: "set null" }
    ),
    matchedVendorId: text("matched_vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    matchStatus: text("match_status").notNull().default("unmatched"),
    matchConfidence: real("match_confidence").notNull().default(0),
    portalAccessStatus: text("portal_access_status")
      .notNull()
      .default("not_granted"),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    sourceNotes: text("source_notes"),
    reviewNotes: text("review_notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_staging_access_org_key_unique").on(
      table.organizationId,
      table.sourceKey
    ),
    index("buildertrend_staging_access_source_idx").on(table.sourceRecordId),
    index("buildertrend_staging_access_project_idx").on(table.projectId),
    index("buildertrend_staging_access_contact_idx").on(
      table.buildertrendContactId
    ),
    index("buildertrend_staging_access_review_idx").on(
      table.organizationId,
      table.reviewStatus
    ),
    index("buildertrend_staging_access_portal_idx").on(
      table.organizationId,
      table.portalAccessStatus
    ),
  ]
)

export const buildertrendImportObservations = sqliteTable(
  "buildertrend_staging_observations",
  {
    id: text("id").primaryKey(),
    importRunId: text("import_run_id")
      .notNull()
      .references(() => buildertrendImportRuns.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityKind: text("entity_kind").notNull(),
    entityKey: text("entity_key").notNull(),
    entityId: text("entity_id").notNull(),
    observedPayloadJson: text("observed_payload_json").notNull(),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_staging_observations_run_entity_unique").on(
      table.importRunId,
      table.entityKind,
      table.entityKey
    ),
    index("buildertrend_staging_observations_entity_idx").on(
      table.organizationId,
      table.entityKind,
      table.entityId
    ),
  ]
)

export const buildertrendIdentityReviewRuns = sqliteTable(
  "buildertrend_staging_identity_review_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewKey: text("review_key").notNull(),
    manifestFingerprint: text("manifest_fingerprint").notNull(),
    status: text("status").notNull().default("in_progress"),
    expectedDecisionCount: integer("expected_decision_count").notNull(),
    expectedRelationshipCount: integer("expected_relationship_count")
      .notNull(),
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at").notNull(),
    summaryJson: text("summary_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_identity_review_runs_org_key_unique").on(
      table.organizationId,
      table.reviewKey
    ),
    index("buildertrend_identity_review_runs_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
)

export const buildertrendIdentityDecisions = sqliteTable(
  "buildertrend_staging_identity_decisions",
  {
    id: text("id").primaryKey(),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => buildertrendIdentityReviewRuns.id, {
        onDelete: "restrict",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => buildertrendSourceRecords.id, {
        onDelete: "restrict",
      }),
    sourceKey: text("source_key").notNull(),
    sourceIdentityKind: text("source_identity_kind").notNull(),
    sourceIdentityId: text("source_identity_id").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    disposition: text("disposition").notNull(),
    departmentCode: text("department_code"),
    matchedProjectId: text("matched_project_id").references(
      () => projects.id,
      { onDelete: "set null" }
    ),
    customerProvenanceId: text("customer_provenance_id").references(
      () => customers.id,
      { onDelete: "set null" }
    ),
    customerProvenanceKind: text("customer_provenance_kind")
      .notNull()
      .default("none"),
    portalIdentityAllowed: integer("portal_identity_allowed", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    reviewNotes: text("review_notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_identity_decisions_run_source_unique").on(
      table.reviewRunId,
      table.sourceRecordId
    ),
    index("buildertrend_identity_decisions_org_status_idx").on(
      table.organizationId,
      table.reviewStatus
    ),
    index("buildertrend_identity_decisions_project_idx").on(
      table.matchedProjectId
    ),
    check(
      "buildertrend_identity_decisions_no_portal_access",
      sql`${table.portalIdentityAllowed} = 0`
    ),
  ]
)

export const buildertrendIdentityRelationships = sqliteTable(
  "buildertrend_staging_identity_relationships",
  {
    id: text("id").primaryKey(),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => buildertrendIdentityReviewRuns.id, {
        onDelete: "restrict",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromDecisionId: text("from_decision_id")
      .notNull()
      .references(() => buildertrendIdentityDecisions.id, {
        onDelete: "restrict",
      }),
    toDecisionId: text("to_decision_id")
      .notNull()
      .references(() => buildertrendIdentityDecisions.id, {
        onDelete: "restrict",
      }),
    relationshipType: text("relationship_type").notNull(),
    reviewStatus: text("review_status").notNull().default("needs_review"),
    reviewNotes: text("review_notes"),
    grantsPortalAccess: integer("grants_portal_access", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("buildertrend_identity_relationships_run_edge_unique").on(
      table.reviewRunId,
      table.fromDecisionId,
      table.toDecisionId,
      table.relationshipType
    ),
    index("buildertrend_identity_relationships_org_type_idx").on(
      table.organizationId,
      table.relationshipType
    ),
    check(
      "buildertrend_identity_relationships_no_portal_access",
      sql`${table.grantsPortalAccess} = 0`
    ),
  ]
)

export type BuildertrendImportRun = typeof buildertrendImportRuns.$inferSelect
export type NewBuildertrendImportRun =
  typeof buildertrendImportRuns.$inferInsert
export type BuildertrendSourceRecord =
  typeof buildertrendSourceRecords.$inferSelect
export type NewBuildertrendSourceRecord =
  typeof buildertrendSourceRecords.$inferInsert
export type BuildertrendArchiveFile =
  typeof buildertrendArchiveFiles.$inferSelect
export type NewBuildertrendArchiveFile =
  typeof buildertrendArchiveFiles.$inferInsert
export type BuildertrendAccessCandidate =
  typeof buildertrendAccessCandidates.$inferSelect
export type NewBuildertrendAccessCandidate =
  typeof buildertrendAccessCandidates.$inferInsert
export type BuildertrendImportObservation =
  typeof buildertrendImportObservations.$inferSelect
export type NewBuildertrendImportObservation =
  typeof buildertrendImportObservations.$inferInsert
export type BuildertrendIdentityReviewRun =
  typeof buildertrendIdentityReviewRuns.$inferSelect
export type NewBuildertrendIdentityReviewRun =
  typeof buildertrendIdentityReviewRuns.$inferInsert
export type BuildertrendIdentityDecision =
  typeof buildertrendIdentityDecisions.$inferSelect
export type NewBuildertrendIdentityDecision =
  typeof buildertrendIdentityDecisions.$inferInsert
export type BuildertrendIdentityRelationship =
  typeof buildertrendIdentityRelationships.$inferSelect
export type NewBuildertrendIdentityRelationship =
  typeof buildertrendIdentityRelationships.$inferInsert
