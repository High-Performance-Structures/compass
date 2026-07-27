import {
  index,
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

// Auth and user management tables
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // workos user id
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("office"), // admin, office, field, client
  googleEmail: text("google_email"), // override for google workspace impersonation
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(), // workos org id
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(), // "internal" or "client"
  logoUrl: text("logo_url"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  joinedAt: text("joined_at").notNull(),
})

export const cherishPulseResponses = sqliteTable("cherish_pulse_responses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  submittedBy: text("submitted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  submittedByName: text("submitted_by_name"),
  submittedByEmail: text("submitted_by_email"),
  weekStart: text("week_start").notNull(),
  cherishValue: text("cherish_value").notNull(),
  responseType: text("response_type").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("compass_dashboard"),
  visibility: text("visibility").notNull().default("team"),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  reviewedBy: text("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: text("reviewed_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inAppEnabled: integer("in_app_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  weeklyDigestEnabled: integer("weekly_digest_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  rfiEnabled: integer("rfi_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  ownerUpdateEnabled: integer("owner_update_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  poEnabled: integer("po_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  timeZone: text("time_zone").notNull().default("America/Denver"),
  updatedAt: text("updated_at").notNull(),
})

export const notificationEvents = sqliteTable("notification_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  eventType: text("event_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href").notNull(),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("internal"),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
})

export const notificationRecipients = sqliteTable("notification_recipients", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => notificationEvents.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  inApp: integer("in_app", { mode: "boolean" }).notNull().default(true),
  email: integer("email", { mode: "boolean" }).notNull().default(false),
  push: integer("push", { mode: "boolean" }).notNull().default(false),
  readAt: text("read_at"),
  dismissedAt: text("dismissed_at"),
  createdAt: text("created_at").notNull(),
})

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => notificationEvents.id, { onDelete: "cascade" }),
  recipientId: text("recipient_id")
    .notNull()
    .references(() => notificationRecipients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("queued"),
  toAddress: text("to_address"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  attemptedAt: text("attempted_at"),
  createdAt: text("created_at").notNull(),
})

export const organizationInvites = sqliteTable("organization_invites", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  role: text("role").notNull().default("office"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: text("expires_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
})

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").notNull(),
})

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"), // hex color for badges
  createdAt: text("created_at").notNull(),
})

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  joinedAt: text("joined_at").notNull(),
})

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  projectNumber: text("project_number"),
  name: text("name").notNull(),
  status: text("status").notNull().default("OPEN"),
  address: text("address"),
  clientName: text("client_name"),
  projectManager: text("project_manager"),
  organizationId: text("organization_id").references(() => organizations.id),
  netsuiteJobId: text("netsuite_job_id"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  googleDriveFolderId: text("google_drive_folder_id"),
  googleScheduleSheetId: text("google_schedule_sheet_id"),
  googleDailyLogSheetId: text("google_daily_log_sheet_id"),
  googleCalendarId: text("google_calendar_id"),
  buildertrendProjectId: text("buildertrend_project_id"),
  ownerUpdatesEnabled: integer("owner_updates_enabled", {
    mode: "boolean",
  }).notNull().default(true),
  ownerUpdateChannel: text("owner_update_channel").notNull().default("compass"),
  ownerUpdateCadence: text("owner_update_cadence").notNull().default("weekly"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

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
})

export const dailyLogs = sqliteTable("daily_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => users.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  logDate: text("log_date").notNull(),
  weatherTempF: integer("weather_temp_f"),
  weatherConditions: text("weather_conditions"),
  weatherPrecipitation: text("weather_precipitation"),
  weatherSource: text("weather_source").notNull().default("manual"),
  workCompleted: text("work_completed").notNull(),
  issues: text("issues"),
  materialsUsed: text("materials_used"),
  crewPresent: text("crew_present"),
  hoursWorked: real("hours_worked"),
  safetyIncidents: text("safety_incidents"),
  visitorLog: text("visitor_log"),
  notes: text("notes"),
  isClientVisible: integer("is_client_visible", {
    mode: "boolean",
  }).notNull().default(false),
  reviewStatus: text("review_status").notNull().default("draft"),
  tags: text("tags"),
  syncStatus: text("sync_status").notNull().default("synced"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const dailyLogPhotos = sqliteTable("daily_log_photos", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  dailyLogId: text("daily_log_id").references(() => dailyLogs.id, {
    onDelete: "set null",
  }),
  uploadedBy: text("uploaded_by").references(() => users.id),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceExternalId: text("source_external_id"),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  driveFileId: text("drive_file_id"),
  driveUrl: text("drive_url"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  capturedAt: text("captured_at"),
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  uploadStatus: text("upload_status").notNull().default("pending"),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  ownerVisible: integer("owner_visible", {
    mode: "boolean",
  }).notNull().default(false),
  subVendorVisible: integer("sub_vendor_visible", {
    mode: "boolean",
  }).notNull().default(false),
  publicShareable: integer("public_shareable", {
    mode: "boolean",
  }).notNull().default(false),
  photoKind: text("photo_kind").notNull().default("progress"),
  schedulePhaseOverride: text("schedule_phase_override"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const ownerProjectUpdates = sqliteTable("owner_project_updates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id),
  title: text("title").notNull(),
  updateDate: text("update_date").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("draft"),
  channel: text("channel").notNull().default("compass"),
  sourceDailyLogIds: text("source_daily_log_ids"),
  selectedPhotoIds: text("selected_photo_ids"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  scheduleSnapshot: text("schedule_snapshot"),
  publishedAt: text("published_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectOperations = sqliteTable("project_operations", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  assigneeType: text("assignee_type"),
  assigneeName: text("assignee_name"),
  companyName: text("company_name"),
  costCode: text("cost_code"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  amount: real("amount"),
  externalUrl: text("external_url"),
  sageJobId: text("sage_job_id"),
  sageJobNumber: text("sage_job_number"),
  sageVendorId: text("sage_vendor_id"),
  sageVendorName: text("sage_vendor_name"),
  sagePhaseCode: text("sage_phase_code"),
  sageCostCode: text("sage_cost_code"),
  sageTaxGroup: text("sage_tax_group"),
  sageShipTo: text("sage_ship_to"),
  sageOrderDate: text("sage_order_date"),
  sageRequiredDate: text("sage_required_date"),
  sageWriteStatus: text("sage_write_status").notNull().default("not_ready"),
  sagePayloadJson: text("sage_payload_json"),
  syncDirection: text("sync_direction").notNull().default("read"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const organizationCalendarSettings = sqliteTable(
  "organization_calendar_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    defaultProjectId: text("default_project_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    timeZone: text("time_zone").notNull().default("America/Denver"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
)

export const workCalendarEvents = sqliteTable(
  "work_calendar_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    startDate: text("start_date"),
    endDateExclusive: text("end_date_exclusive"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    allDay: integer("all_day", { mode: "boolean" })
      .notNull()
      .default(false),
    timeZone: text("time_zone").notNull().default("UTC"),
    location: text("location"),
    status: text("status").notNull().default("open"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledBy: text("cancelled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_work_calendar_events_org_start").on(
      table.organizationId,
      table.status,
      table.startDate,
      table.startsAt,
    ),
    index("idx_work_calendar_events_project_start").on(
      table.projectId,
      table.status,
      table.startDate,
      table.startsAt,
    ),
  ],
)

export const workCalendarEventAttendees = sqliteTable(
  "work_calendar_event_attendees",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => workCalendarEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responseStatus: text("response_status").notNull().default("needs_action"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("work_calendar_event_attendee_unique").on(
      table.eventId,
      table.userId,
    ),
    index("idx_work_calendar_event_attendees_user").on(table.userId),
  ],
)

export const projectPurchaseOrderLines = sqliteTable("project_purchase_order_lines", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => projectOperations.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  lineNumber: integer("line_number").notNull().default(1),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitCost: real("unit_cost").notNull().default(0),
  unit: text("unit"),
  amount: real("amount").notNull().default(0),
  taxGroup: text("tax_group"),
  sagePayloadJson: text("sage_payload_json"),
  syncStatus: text("sync_status").notNull().default("pending_sage"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
  supplierName: text("supplier_name"),
  productUrl: text("product_url"),
  costCode: text("cost_code"),
  phaseCode: text("phase_code"),
  status: text("status").notNull().default("needed"),
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
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
})

export const projectBudgetApplications = sqliteTable("project_budget_applications", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  applicationNumber: text("application_number").notNull(),
  periodTo: text("period_to"),
  status: text("status").notNull().default("current"),
  originalContractSum: real("original_contract_sum").notNull().default(0),
  netChanges: real("net_changes").notNull().default(0),
  contractSumToDate: real("contract_sum_to_date").notNull().default(0),
  totalCompletedStoredToDate: real("total_completed_stored_to_date")
    .notNull()
    .default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  totalEarnedLessRetainage: real("total_earned_less_retainage")
    .notNull()
    .default(0),
  previousCertificates: real("previous_certificates").notNull().default(0),
  currentPaymentDue: real("current_payment_due").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  sourceUrl: text("source_url"),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectBudgetLines = sqliteTable("project_budget_lines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  applicationId: text("application_id").references(
    () => projectBudgetApplications.id,
    { onDelete: "set null" }
  ),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  costCode: text("cost_code").notNull(),
  csiDivision: text("csi_division").notNull(),
  csiDivisionName: text("csi_division_name").notNull(),
  description: text("description").notNull(),
  notes: text("notes"),
  originalEstimate: real("original_estimate").notNull().default(0),
  priorChanges: real("prior_changes").notNull().default(0),
  currentChanges: real("current_changes").notNull().default(0),
  totalChanges: real("total_changes").notNull().default(0),
  adjustedEstimate: real("adjusted_estimate").notNull().default(0),
  priorCosts: real("prior_costs").notNull().default(0),
  currentCosts: real("current_costs").notNull().default(0),
  totalCosts: real("total_costs").notNull().default(0),
  percentComplete: real("percent_complete").notNull().default(0),
  balanceToFinish: real("balance_to_finish").notNull().default(0),
  retainageHeld: real("retainage_held").notNull().default(0),
  vendorName: text("vendor_name"),
  ownerLabel: text("owner_label"),
  ownerVisible: integer("owner_visible", { mode: "boolean" })
    .notNull()
    .default(false),
  internalNotes: text("internal_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectRfis = sqliteTable("project_rfis", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  rfiNumber: text("rfi_number").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("internal"),
  requesterName: text("requester_name"),
  assignedToName: text("assigned_to_name"),
  companyName: text("company_name"),
  dueDate: text("due_date"),
  submittedAt: text("submitted_at").notNull(),
  answeredAt: text("answered_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectRfiAttachments = sqliteTable("project_rfi_attachments", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  rfiId: text("rfi_id")
    .notNull()
    .references(() => projectRfis.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size").notNull().default(0),
  storageProvider: text("storage_provider").notNull().default("google_drive"),
  storageId: text("storage_id"),
  storageUrl: text("storage_url"),
  storageStatus: text("storage_status").notNull().default("uploaded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectContacts = sqliteTable("project_contacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  contactType: text("contact_type").notNull(), // owner, supplier, subcontractor, internal
  sourceSystem: text("source_system").notNull().default("compass"),
  sourceRecordId: text("source_record_id"),
  sourceEntityType: text("source_entity_type").notNull().default("manual"),
  sourceEntityId: text("source_entity_id"),
  displayName: text("display_name").notNull(),
  companyName: text("company_name"),
  role: text("role"),
  trade: text("trade"),
  csiDivision: text("csi_division"),
  csiDivisionName: text("csi_division_name"),
  primaryCostCode: text("primary_cost_code"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  ownerPortalVisible: integer("owner_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  subVendorPortalVisible: integer("sub_vendor_portal_visible", {
    mode: "boolean",
  }).notNull().default(false),
  internalVisible: integer("internal_visible", {
    mode: "boolean",
  }).notNull().default(true),
  primaryContact: integer("primary_contact", {
    mode: "boolean",
  }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const projectContactSourceLinks = sqliteTable("project_contact_source_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  projectContactId: text("project_contact_id").references(
    () => projectContacts.id,
    { onDelete: "set null" }
  ),
  sourceSystem: text("source_system").notNull(),
  sourceRecordType: text("source_record_type").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  sourceRecordNumber: text("source_record_number"),
  sourceLabel: text("source_label").notNull(),
  sourceName: text("source_name").notNull(),
  matchStatus: text("match_status").notNull().default("unmatched"),
  matchConfidence: real("match_confidence").notNull().default(0),
  matchReason: text("match_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

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
})

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  workdays: integer("workdays").notNull(),
  endDateCalculated: text("end_date_calculated").notNull(),
  phase: text("phase").notNull(),
  displayColor: text("display_color").notNull().default("blue"),
  status: text("status").notNull().default("PENDING"),
  isCriticalPath: integer("is_critical_path", { mode: "boolean" })
    .notNull()
    .default(false),
  isMilestone: integer("is_milestone", { mode: "boolean" })
    .notNull()
    .default(false),
  percentComplete: integer("percent_complete").notNull().default(0),
  assignedTo: text("assigned_to"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const dailyLogTaskLinks = sqliteTable("daily_log_task_links", {
  id: text("id").primaryKey(),
  dailyLogId: text("daily_log_id")
    .notNull()
    .references(() => dailyLogs.id, { onDelete: "cascade" }),
  scheduleTaskId: text("schedule_task_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
})

export const taskDependencies = sqliteTable("task_dependencies", {
  id: text("id").primaryKey(),
  predecessorId: text("predecessor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  successorId: text("successor_id")
    .notNull()
    .references(() => scheduleTasks.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("FS"),
  lagDays: integer("lag_days").notNull().default(0),
})

export const workdayExceptions = sqliteTable("workday_exceptions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  type: text("type").notNull().default("non_working"),
  category: text("category").notNull().default("company_holiday"),
  recurrence: text("recurrence").notNull().default("one_time"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const scheduleBaselines = sqliteTable("schedule_baselines", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  netsuiteId: text("netsuite_id"),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Subcontractor"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  netsuiteId: text("netsuite_id"),
  sourceSystem: text("source_system").notNull().default("manual"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  sourceMetadata: text("source_metadata"),
  directoryStatus: text("directory_status").notNull().default("active"),
  syncStatus: text("sync_status").notNull().default("manual"),
  lastSyncedAt: text("last_synced_at"),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
})

export const sageCostCodes = sqliteTable("sage_cost_codes", {
  id: text("id").primaryKey(),
  sourceSystem: text("source_system").notNull().default("sage"),
  sourceRecordId: text("source_record_id"),
  sourceRecordNumber: text("source_record_number"),
  code: text("code").notNull(),
  description: text("description").notNull(),
  displayLabel: text("display_label").notNull(),
  divisionCode: text("division_code").notNull(),
  divisionDescription: text("division_description").notNull(),
  divisionDisplayLabel: text("division_display_label").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  syncStatus: text("sync_status").notNull().default("synced"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type Project = typeof projects.$inferSelect
export type ProjectExternalLink = typeof projectExternalLinks.$inferSelect
export type NewProjectExternalLink = typeof projectExternalLinks.$inferInsert
export type DailyLog = typeof dailyLogs.$inferSelect
export type NewDailyLog = typeof dailyLogs.$inferInsert
export type DailyLogPhoto = typeof dailyLogPhotos.$inferSelect
export type NewDailyLogPhoto = typeof dailyLogPhotos.$inferInsert
export type DailyLogTaskLink = typeof dailyLogTaskLinks.$inferSelect
export type NewDailyLogTaskLink = typeof dailyLogTaskLinks.$inferInsert
export type OwnerProjectUpdate = typeof ownerProjectUpdates.$inferSelect
export type NewOwnerProjectUpdate = typeof ownerProjectUpdates.$inferInsert
export type ProjectOperation = typeof projectOperations.$inferSelect
export type NewProjectOperation = typeof projectOperations.$inferInsert
export type WorkCalendarEvent = typeof workCalendarEvents.$inferSelect
export type NewWorkCalendarEvent = typeof workCalendarEvents.$inferInsert
export type OrganizationCalendarSettings =
  typeof organizationCalendarSettings.$inferSelect
export type NewOrganizationCalendarSettings =
  typeof organizationCalendarSettings.$inferInsert
export type WorkCalendarEventAttendee =
  typeof workCalendarEventAttendees.$inferSelect
export type NewWorkCalendarEventAttendee =
  typeof workCalendarEventAttendees.$inferInsert
export type ProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferSelect
export type NewProjectPurchaseOrderLine =
  typeof projectPurchaseOrderLines.$inferInsert
export type ProjectFinishSelection =
  typeof projectFinishSelections.$inferSelect
export type NewProjectFinishSelection =
  typeof projectFinishSelections.$inferInsert
export type ProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferSelect
export type NewProjectFinishSelectionRoom =
  typeof projectFinishSelectionRooms.$inferInsert
export type ProjectBudgetApplication =
  typeof projectBudgetApplications.$inferSelect
export type NewProjectBudgetApplication =
  typeof projectBudgetApplications.$inferInsert
export type ProjectBudgetLine = typeof projectBudgetLines.$inferSelect
export type NewProjectBudgetLine = typeof projectBudgetLines.$inferInsert
export type ProjectRfi = typeof projectRfis.$inferSelect
export type NewProjectRfi = typeof projectRfis.$inferInsert
export type ProjectRfiAttachment = typeof projectRfiAttachments.$inferSelect
export type NewProjectRfiAttachment = typeof projectRfiAttachments.$inferInsert
export type ProjectContact = typeof projectContacts.$inferSelect
export type NewProjectContact = typeof projectContacts.$inferInsert
export type ProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferSelect
export type NewProjectContactSourceLink =
  typeof projectContactSourceLinks.$inferInsert
export type ScheduleTask = typeof scheduleTasks.$inferSelect
export type NewScheduleTask = typeof scheduleTasks.$inferInsert
export type TaskDependency = typeof taskDependencies.$inferSelect
export type NewTaskDependency = typeof taskDependencies.$inferInsert
export type WorkdayException = typeof workdayExceptions.$inferSelect
export type NewWorkdayException = typeof workdayExceptions.$inferInsert
export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect
export type NewScheduleBaseline = typeof scheduleBaselines.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type SageCostCode = typeof sageCostCodes.$inferSelect
export type NewSageCostCode = typeof sageCostCodes.$inferInsert
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  name: text("name"),
  email: text("email"),
  pageUrl: text("page_url"),
  userAgent: text("user_agent"),
  viewportWidth: integer("viewport_width"),
  viewportHeight: integer("viewport_height"),
  ipHash: text("ip_hash"),
  githubIssueUrl: text("github_issue_url"),
  createdAt: text("created_at").notNull(),
})

export type Vendor = typeof vendors.$inferSelect
export type NewVendor = typeof vendors.$inferInsert
export type Feedback = typeof feedback.$inferSelect
export type NewFeedback = typeof feedback.$inferInsert

// Auth and user management types
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrganizationMember = typeof organizationMembers.$inferSelect
export type NewOrganizationMember = typeof organizationMembers.$inferInsert
export type NotificationPreference =
  typeof notificationPreferences.$inferSelect
export type NewNotificationPreference =
  typeof notificationPreferences.$inferInsert
export type NotificationEvent = typeof notificationEvents.$inferSelect
export type NewNotificationEvent = typeof notificationEvents.$inferInsert
export type NotificationRecipient =
  typeof notificationRecipients.$inferSelect
export type NewNotificationRecipient =
  typeof notificationRecipients.$inferInsert
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
export type NewNotificationDelivery =
  typeof notificationDeliveries.$inferInsert
export type OrganizationInvite = typeof organizationInvites.$inferSelect
export type NewOrganizationInvite = typeof organizationInvites.$inferInsert
export type Team = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert
export type TeamMember = typeof teamMembers.$inferSelect
export type NewTeamMember = typeof teamMembers.$inferInsert
export type Group = typeof groups.$inferSelect
export type NewGroup = typeof groups.$inferInsert
export type GroupMember = typeof groupMembers.$inferSelect
export type NewGroupMember = typeof groupMembers.$inferInsert
export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert

// Agent memory tables for ElizaOS
export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
})

export const agentMemories = sqliteTable("agent_memories", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  embedding: text("embedding"), // JSON array of floats for vector search
  metadata: text("metadata"), // JSON object for action results, ui specs, etc.
  createdAt: text("created_at").notNull(),
})

export type AgentConversation = typeof agentConversations.$inferSelect
export type NewAgentConversation = typeof agentConversations.$inferInsert
export type AgentMemory = typeof agentMemories.$inferSelect
export type NewAgentMemory = typeof agentMemories.$inferInsert

// Feedback interview table for UX research
export const feedbackInterviews = sqliteTable("feedback_interviews", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  userName: text("user_name").notNull(),
  userRole: text("user_role").notNull(),
  responses: text("responses").notNull(),
  summary: text("summary").notNull(),
  painPoints: text("pain_points"),
  featureRequests: text("feature_requests"),
  overallSentiment: text("overall_sentiment").notNull(),
  githubIssueUrl: text("github_issue_url"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull(),
})

export type FeedbackInterview = typeof feedbackInterviews.$inferSelect
export type NewFeedbackInterview = typeof feedbackInterviews.$inferInsert

// Slab persistent memory
export const slabMemories = sqliteTable("slab_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  memoryType: text("memory_type").notNull(), // preference | workflow | fact | decision
  tags: text("tags"), // comma-separated, lowercase
  importance: real("importance").notNull().default(0.7),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  createdAt: text("created_at").notNull(),
})

export type SlabMemory = typeof slabMemories.$inferSelect
export type NewSlabMemory = typeof slabMemories.$inferInsert

// Push notification tokens for native app
export const pushTokens = sqliteTable("push_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  platform: text("platform").notNull(), // "ios" | "android"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export type PushToken = typeof pushTokens.$inferSelect
export type NewPushToken = typeof pushTokens.$inferInsert
