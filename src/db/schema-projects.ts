/*
 * The project (job) record and what hangs directly off it: projects, travel
 * charge settings and per-job overrides, job number reservations, aliases,
 * retirements and review decisions, route aliases, duplicate decisions,
 * registry removals, custom job statuses, profile audit and Sage profile sync
 * operations, external links, members, external resource grants and portal
 * access invitations.
 * Written by: src/lib/domain/project/.
 */

import { sql } from "drizzle-orm"
import {
  check,
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  DELIVERY_METHODS,
  FIELD_APP_VISIBILITIES,
  PORTFOLIO_MAP_VISIBILITIES,
  PROJECT_CLIENT_STATUSES,
  PROJECT_CONTRACT_TYPES,
  PROJECT_DEPARTMENTS,
  PROJECT_DUPLICATE_DECISION_STATUSES,
  PROJECT_LODGING_CHOICES,
  PROJECT_NUMBER_REVIEW_STATUSES,
  SITE_LOCATION_STATUSES,
  WORKSPACE_KINDS,
} from "../lib/domain/project/statuses"
import { customers, projectContacts } from "./schema-contacts"
import { ownerProjectUpdates } from "./schema-field"
import { organizations, users } from "./schema-identity"

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectNumber: text("project_number"),
  department: text("department", { enum: PROJECT_DEPARTMENTS }),
  name: text("name").notNull(),
  status: text("status").notNull().default("OPEN"),
  // `address` remains the project/site address for compatibility with existing data.
  address: text("address"),
  mailingAddress: text("mailing_address"),
  clientStatus: text("client_status", { enum: PROJECT_CLIENT_STATUSES }).notNull().default("customer"),
  jobStatusId: text("job_status_id").notNull().default("current"),
  // Fallback copy, not a snapshot: the client name as typed or imported. Reads
  // prefer the linked directory client (clientCustomerId) and fall back to it.
  clientName: text("client_name"),
  /** The directory client this job is for (0280); null until picked or backfilled. */
  clientCustomerId: text("client_customer_id").references(() => customers.id, { onDelete: "set null" }),
  /**
   * Internal workspaces are not client jobs: "office" for administrative duty
   * logs (H-Office), "executive" for the owner's office (Woodland Park Home
   * Office), "field" for crew work at the yard or generic order help.
   * Null for every client project.
   */
  workspaceKind: text("workspace_kind", { enum: WORKSPACE_KINDS }),
  /**
   * Listed under the company's Internal department on the Project Hub rather
   * than its own department. Only internal workspaces set it; a workspace can
   * stay with its department (a crew workspace for one department's orders).
   */
  internalDepartment: integer("internal_department", { mode: "boolean" }).notNull().default(false),
  projectManager: text("project_manager"),
  organizationId: text("organization_id").references(() => organizations.id),
  netsuiteJobId: text("netsuite_job_id"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  sageJobStatusName: text("sage_job_status_name"),
  sageJobStatusNumber: integer("sage_job_status_number"),
  sageJobTypeName: text("sage_job_type_name"),
  sageJobTypeNumber: integer("sage_job_type_number"),
  googleDriveFolderId: text("google_drive_folder_id"),
  /** The published document shown as this project's working plan set; null when none is pinned. */
  planSetDocumentId: text("plan_set_document_id"),
  googleScheduleSheetId: text("google_schedule_sheet_id"),
  googleDailyLogSheetId: text("google_daily_log_sheet_id"),
  googleCalendarId: text("google_calendar_id"),
  buildertrendProjectId: text("buildertrend_project_id"),
  ownerUpdatesEnabled: integer("owner_updates_enabled", {
    mode: "boolean",
  }).notNull().default(true),
  ownerUpdateChannel: text("owner_update_channel").notNull().default("compass"),
  ownerUpdateCadence: text("owner_update_cadence").notNull().default("weekly"),
  ownerScheduleView: text("owner_schedule_view").notNull().default("items"),
  // Public-facing copy must not reuse the internal project name or full address.
  publicTitle: text("public_title"),
  publicLocationCity: text("public_location_city"),
  /** Portfolio map override: "default" follows status and department rules. */
  portfolioMapVisibility: text("portfolio_map_visibility", { enum: PORTFOLIO_MAP_VISIBILITIES })
    .notNull()
    .default("default"),
  /** Field app override (0317): null is Automatic (company Settings decide), "shown" or "hidden". */
  fieldAppVisibility: text("field_app_visibility", { enum: FIELD_APP_VISIBILITIES }),
  schedulePublished: integer("schedule_published", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Publications before this time no longer count ("Treat as never published", 0296). */
  schedulePublicationResetAt: text("schedule_publication_reset_at"),
  /** Imported (e.g. Buildertrend) conversations stay internal-staff only, e.g. under a legal hold (0287). */
  importedConversationsStaffOnly: integer("imported_conversations_staff_only", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * Geocoded site and its ground elevation, cached for zone and mountain
   * charges. `siteLocationAddress` is the address that was looked up, so an
   * edited address is located again.
   */
  siteLatitude: real("site_latitude"),
  siteLongitude: real("site_longitude"),
  siteElevationFt: integer("site_elevation_ft"),
  siteLocationAddress: text("site_location_address"),
  siteLocationStatus: text("site_location_status", { enum: SITE_LOCATION_STATUSES }),
  siteLocatedAt: text("site_located_at"),
  /** Set when the site was placed from a nearby number or the street, e.g. "Near 1062 CR 8952". */
  siteLocationNote: text("site_location_note"),
  /** Material sales: delivered to the project address, or picked up by the customer. */
  deliveryMethod: text("delivery_method", { enum: DELIVERY_METHODS }),
  /** Owner contract type (0299); null follows the company default. Decides variances and fee. */
  contractType: text("contract_type", { enum: PROJECT_CONTRACT_TYPES }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (table) => [
  uniqueIndex("projects_organization_id_unique").on(table.organizationId, table.id),
  // Declared from drizzle/0280_relational_directory_links.sql.
  index("projects_client_customer_id_idx").on(table.clientCustomerId),
    // Declared from drizzle/0105_project_number_namespace.sql (COLLATE NOCASE, so the column is a sql`` expression).
    uniqueIndex("projects_org_project_number_unique").on(table.organizationId, sql`${table.projectNumber} COLLATE NOCASE`).where(sql`"project_number" IS NOT NULL`),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("projects_plan_set_document_id_idx").on(table.planSetDocumentId),
  ])

/** Zone and mountain charge rates (JSON validated by travelChargeSettingsSchema). */
export const travelChargeSettings = sqliteTable("travel_charge_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  settingsJson: text("settings_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
})

/**
 * Per-job zone charge adjustments. Every value is optional; NULL keeps the
 * organization default. Kept apart from the cached site columns on projects,
 * which the background site lookup rewrites.
 */
export const projectTravelChargeOverrides = sqliteTable(
  "project_travel_charge_overrides",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    zoneIndex: integer("zone_index"),
    zoneRateCents: integer("zone_rate_cents"),
    siteElevationFt: integer("site_elevation_ft"),
    mountainRateCents: integer("mountain_rate_cents"),
    lodging: text("lodging", { enum: PROJECT_LODGING_CHOICES }).notNull().default("default"),
    lodgingPerNightCents: integer("lodging_per_night_cents"),
    perDiemPerDayCents: integer("per_diem_per_day_cents"),
    note: text("note"),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("project_travel_charge_overrides_org_idx").on(table.organizationId)],
)

export const projectNumberReservations = sqliteTable(
  "project_number_reservations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    department: text("department").notNull(),
    sequence: integer("sequence").notNull(),
    projectNumber: text("project_number").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_number_reservations_org_department_sequence_unique").on(
      table.organizationId,
      table.department,
      table.sequence
    ),
    uniqueIndex("project_number_reservations_org_number_unique").on(
      table.organizationId,
      table.projectNumber
    ),
    index("project_number_reservations_project_id_idx").on(table.projectId),
  ]
)

export const projectNumberAliases = sqliteTable(
  "project_number_aliases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    projectNumber: text("project_number").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_number_aliases_org_number_unique").on(
      table.organizationId,
      table.projectNumber,
    ),
    // Declared from drizzle/0104_project_number_aliases.sql.
    index("project_number_aliases_org_number_idx").on(table.organizationId, table.projectNumber),
    index("project_number_aliases_project_id_idx").on(table.projectId),
  ],
)

export const projectRouteAliases = sqliteTable(
  "project_route_aliases",
  {
    sourceProjectId: text("source_project_id").primaryKey(),
    targetProjectId: text("target_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull().default("compass"),
    sourceExternalId: text("source_external_id"),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "project_route_aliases_distinct_projects_check",
      sql`${table.sourceProjectId} <> ${table.targetProjectId}`,
    ),
    index("project_route_aliases_target_idx").on(table.targetProjectId),
    index("project_route_aliases_organization_idx").on(table.organizationId),
  ],
)

export const projectDuplicateDecisions = sqliteTable(
  "project_duplicate_decisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectAId: text("project_a_id").notNull(),
    projectBId: text("project_b_id").notNull(),
    status: text("status", { enum: PROJECT_DUPLICATE_DECISION_STATUSES }).notNull(),
    keptProjectId: text("kept_project_id"),
    removedProjectId: text("removed_project_id"),
    score: integer("score").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    removedProjectSnapshotJson: text("removed_project_snapshot_json"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: text("resolved_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "project_duplicate_decisions_distinct_projects_check",
      sql`${table.projectAId} < ${table.projectBId}`,
    ),
    check(
      "project_duplicate_decisions_merge_selection_check",
      sql`(${table.status} = 'not_duplicate' AND ${table.keptProjectId} IS NULL AND ${table.removedProjectId} IS NULL) OR (${table.status} = 'merged' AND ${table.keptProjectId} IS NOT NULL AND ${table.removedProjectId} IS NOT NULL AND ${table.keptProjectId} <> ${table.removedProjectId})`,
    ),
    uniqueIndex("project_duplicate_decisions_org_pair_unique").on(
      table.organizationId,
      table.projectAId,
      table.projectBId,
    ),
    index("project_duplicate_decisions_org_status_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("project_duplicate_decisions_removed_idx").on(table.removedProjectId, table.status),
    // Declared from drizzle/0281_id_reference_triggers.sql.
    index("project_duplicate_decisions_kept_project_id_idx").on(table.keptProjectId),
    index("project_duplicate_decisions_project_a_id_idx").on(table.projectAId),
    index("project_duplicate_decisions_project_b_id_idx").on(table.projectBId),
  ],
)

export const projectNumberReviewDecisions = sqliteTable(
  "project_number_review_decisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectNumber: text("project_number").notNull(),
    status: text("status", { enum: PROJECT_NUMBER_REVIEW_STATUSES }).notNull(),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: text("resolved_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("project_number_review_decisions_status_check", sql`${table.status} = 'approved_exception'`),
    uniqueIndex("project_number_review_decisions_org_project_number_unique").on(table.organizationId, table.projectId, table.projectNumber),
    index("project_number_review_decisions_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
    index("project_number_review_decisions_project_id_idx").on(table.projectId),
  ],
)

export const projectRegistryRemovals = sqliteTable(
  "project_registry_removals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    originalProjectNumber: text("original_project_number"),
    originalStatus: text("original_status").notNull(),
    projectSnapshotJson: text("project_snapshot_json").notNull(),
    removedByUserId: text("removed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    removedAt: text("removed_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_registry_removals_org_project_unique").on(table.organizationId, table.projectId),
    index("project_registry_removals_org_removed_idx").on(table.organizationId, table.removedAt),
    // Declared from drizzle/0274_hot_query_indexes.sql.
    index("project_registry_removals_project_idx").on(table.projectId),
  ],
)

export const projectNumberRetirements = sqliteTable(
  "project_number_retirements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    formerProjectId: text("former_project_id").notNull(),
    projectNumber: text("project_number").notNull(),
    department: text("department"),
    sequence: integer("sequence"),
    retiredByUserId: text("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
    retiredAt: text("retired_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_number_retirements_org_number_unique").on(table.organizationId, table.projectNumber),
    uniqueIndex("project_number_retirements_org_department_sequence_unique").on(table.organizationId, table.department, table.sequence),
  ],
)

export const projectJobStatuses = sqliteTable(
  "project_job_statuses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sageCode: text("sage_code"),
    followUpCadenceDays: integer("follow_up_cadence_days"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(1000),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_job_statuses_org_label_unique").on(
      table.organizationId,
      table.label,
    ),
    index("project_job_statuses_org_active_idx").on(
      table.organizationId,
      table.active,
      table.sortOrder,
    ),
  ],
)

export const projectJobStatusLabelKeys = sqliteTable(
  "project_job_status_label_keys",
  {
    statusId: text("status_id")
      .primaryKey()
      .references(() => projectJobStatuses.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    normalizedLabel: text("normalized_label").notNull(),
  },
  (table) => [
    uniqueIndex("project_job_status_label_keys_org_normalized_unique").on(
      table.organizationId,
      table.normalizedLabel,
    ),
  ],
)

export const projectJobStatusLabelConflicts = sqliteTable(
  "project_job_status_label_conflicts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    retainedStatusId: text("retained_status_id").notNull(),
    retainedLabel: text("retained_label").notNull(),
    discardedStatusId: text("discarded_status_id").notNull(),
    discardedLabel: text("discarded_label").notNull(),
    discardedSageCode: text("discarded_sage_code"),
    discardedFollowUpCadenceDays: integer("discarded_follow_up_cadence_days"),
    discardedActive: integer("discarded_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_job_status_label_conflicts_org_idx").on(table.organizationId),
    uniqueIndex("project_job_status_label_conflicts_discarded_unique").on(
      table.discardedStatusId,
    ),
  ],
)

export const projectProfileAuditEvents = sqliteTable(
  "project_profile_audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_profile_audit_events_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
)

export const projectProfileSyncOperations = sqliteTable(
  "project_profile_sync_operations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    status: text("status").notNull().default("pending"),
    payloadJson: text("payload_json").notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    attemptedAt: text("attempted_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_profile_sync_operations_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("project_profile_sync_operations_organization_id_idx").on(table.organizationId),
  ],
)

export const projectExternalLinks = sqliteTable("project_external_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  system: text("system").notNull(),
  label: text("label").notNull(),
  externalId: text("external_id"),
  externalNumber: text("external_number"),
  externalUrl: text("external_url"),
  syncDirection: text("sync_direction").notNull().default("read"),
  syncStatus: text("sync_status").notNull().default("unmapped"),
  metadata: text("metadata"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0030_project_registry.sql.
    index("project_external_links_project_idx").on(table.projectId),
    // Declared from drizzle/0030_project_registry.sql.
    index("project_external_links_system_external_idx").on(table.system, table.externalId),
  ])

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  assignedAt: text("assigned_at").notNull(),
}, (table) => [
  // Project access checks filter by project, by user, or both.
  index("project_members_user_idx").on(table.userId),
  index("project_members_project_user_idx").on(table.projectId, table.userId),
  uniqueIndex("project_members_project_user_unique").on(table.projectId, table.userId),
])

export const projectExternalResourceGrants = sqliteTable(
  "project_external_resource_grants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    sourceOwnerUpdateId: text("source_owner_update_id").references(
      () => ownerProjectUpdates.id,
      { onDelete: "cascade" }
    ),
    audience: text("audience").notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: text("granted_at").notNull(),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("project_external_resource_grants_active_unique")
      .on(
        table.projectId,
        table.resourceType,
        table.resourceId,
        table.audience,
        table.recipientUserId
      )
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.sourceOwnerUpdateId} IS NULL`
      ),
    uniqueIndex("project_external_resource_grants_owner_update_active_unique")
      .on(
        table.sourceOwnerUpdateId,
        table.resourceType,
        table.resourceId,
        table.audience,
        table.recipientUserId
      )
      .where(
        sql`${table.revokedAt} IS NULL AND ${table.sourceOwnerUpdateId} IS NOT NULL`
      ),
    index("project_external_resource_grants_owner_update_idx").on(
      table.sourceOwnerUpdateId,
      table.recipientUserId,
      table.resourceType,
      table.resourceId
    ),
    index("project_external_resource_grants_recipient_idx").on(
      table.recipientUserId,
      table.projectId,
      table.resourceType,
      table.resourceId,
      table.audience
    ),
    index("project_external_resource_grants_organization_id_idx").on(table.organizationId),
  ]
)

export const projectAccessInvitations = sqliteTable(
  "project_access_invitations",
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
      { onDelete: "set null" }
    ),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("sent"),
    workosInvitationId: text("workos_invitation_id"),
    workosExpiresAt: text("workos_expires_at"),
    emailProvider: text("email_provider"),
    emailProviderMessageId: text("email_provider_message_id"),
    emailError: text("email_error"),
    emailStatus: text("email_status").notNull().default("unknown"),
    emailSubject: text("email_subject"),
    emailMessage: text("email_message"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailNextAttemptAt: text("email_next_attempt_at"),
    emailClaimToken: text("email_claim_token"),
    emailClaimedAt: text("email_claimed_at"),
    emailSentAt: text("email_sent_at"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invitedAt: text("invited_at").notNull(),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_project_access_invites_project").on(table.projectId),
    index("idx_project_access_invites_email").on(table.email),
    index("idx_project_access_invites_status").on(table.status),
    index("idx_project_access_invites_email_dispatch").on(table.emailStatus, table.emailNextAttemptAt),
    uniqueIndex("idx_project_access_invites_one_queued_welcome").on(table.projectId, table.projectContactId)
      .where(sql`${table.emailStatus} IN ('queued', 'retrying', 'sending') AND ${table.projectContactId} IS NOT NULL`),
    index("project_access_invitations_project_contact_id_idx").on(table.projectContactId),
    index("project_access_invitations_organization_id_idx").on(table.organizationId),
  ]
)

export type Project = typeof projects.$inferSelect

export type ProjectRouteAlias = typeof projectRouteAliases.$inferSelect

export type NewProjectRouteAlias = typeof projectRouteAliases.$inferInsert

export type ProjectDuplicateDecision =
  typeof projectDuplicateDecisions.$inferSelect

export type NewProjectDuplicateDecision =
  typeof projectDuplicateDecisions.$inferInsert

export type ProjectExternalLink = typeof projectExternalLinks.$inferSelect

export type NewProjectExternalLink = typeof projectExternalLinks.$inferInsert

export type ProjectMember = typeof projectMembers.$inferSelect

export type NewProjectMember = typeof projectMembers.$inferInsert

export type ProjectExternalResourceGrant =
  typeof projectExternalResourceGrants.$inferSelect

export type NewProjectExternalResourceGrant =
  typeof projectExternalResourceGrants.$inferInsert

export type ProjectAccessInvitation =
  typeof projectAccessInvitations.$inferSelect

export type NewProjectAccessInvitation =
  typeof projectAccessInvitations.$inferInsert
