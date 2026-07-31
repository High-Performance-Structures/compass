CREATE TABLE `buildertrend_staging_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `run_key` text NOT NULL,
  `manifest_fingerprint` text NOT NULL,
  `source_method` text NOT NULL,
  `source_label` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `started_by` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  `raw_artifact_drive_file_id` text,
  `raw_artifact_drive_url` text,
  `source_notes` text,
  `summary_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_staging_runs_org_key_unique` ON `buildertrend_staging_runs` (`organization_id`, `run_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_runs_org_status_idx` ON `buildertrend_staging_runs` (`organization_id`, `status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `source_key` text NOT NULL,
  `requested_project_id` text,
  `project_id` text,
  `source_scope` text DEFAULT 'job' NOT NULL,
  `source_record_type` text NOT NULL,
  `buildertrend_job_id` text,
  `buildertrend_lead_id` text,
  `buildertrend_record_id` text,
  `buildertrend_record_number` text,
  `buildertrend_url` text,
  `title` text NOT NULL,
  `record_date` text,
  `record_status` text,
  `source_status` text,
  `department_code` text,
  `client_name` text,
  `contact_name` text,
  `contact_email` text,
  `amount` real,
  `searchable_text` text,
  `normalized_summary` text,
  `raw_payload_json` text,
  `source_archive_drive_folder_id` text,
  `source_archive_drive_file_id` text,
  `source_archive_drive_url` text,
  `verified_archive_drive_folder_id` text,
  `verified_archive_drive_file_id` text,
  `verified_archive_drive_url` text,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `promotion_status` text DEFAULT 'archive_only' NOT NULL,
  `promoted_record_type` text,
  `promoted_record_id` text,
  `sage_reconciliation_status` text DEFAULT 'not_reviewed' NOT NULL,
  `source_notes` text,
  `review_notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_staging_records_org_key_unique` ON `buildertrend_staging_records` (`organization_id`, `source_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_records_project_type_idx` ON `buildertrend_staging_records` (`project_id`, `source_record_type`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_records_job_idx` ON `buildertrend_staging_records` (`buildertrend_job_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_records_lead_idx` ON `buildertrend_staging_records` (`buildertrend_lead_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_records_review_idx` ON `buildertrend_staging_records` (`organization_id`, `review_status`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_records_promotion_idx` ON `buildertrend_staging_records` (`organization_id`, `promotion_status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_files` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `source_key` text NOT NULL,
  `requested_source_record_key` text,
  `source_record_id` text,
  `requested_project_id` text,
  `project_id` text,
  `source_scope` text DEFAULT 'job' NOT NULL,
  `source_record_type` text NOT NULL,
  `buildertrend_job_id` text,
  `buildertrend_lead_id` text,
  `buildertrend_file_id` text,
  `buildertrend_url` text,
  `file_name` text NOT NULL,
  `mime_type` text,
  `file_size` integer,
  `source_drive_folder_id` text,
  `source_drive_file_id` text,
  `source_drive_url` text,
  `source_thumbnail_drive_file_id` text,
  `source_thumbnail_url` text,
  `verified_drive_folder_id` text,
  `verified_drive_file_id` text,
  `verified_drive_url` text,
  `verified_thumbnail_drive_file_id` text,
  `verified_thumbnail_url` text,
  `source_checksum` text,
  `verified_checksum` text,
  `captured_at` text,
  `visibility` text DEFAULT 'internal' NOT NULL,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `source_metadata_json` text,
  `review_metadata_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_record_id`) REFERENCES `buildertrend_staging_records`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_staging_files_org_key_unique` ON `buildertrend_staging_files` (`organization_id`, `source_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_files_source_idx` ON `buildertrend_staging_files` (`source_record_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_files_project_idx` ON `buildertrend_staging_files` (`project_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_files_job_idx` ON `buildertrend_staging_files` (`buildertrend_job_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_files_review_idx` ON `buildertrend_staging_files` (`organization_id`, `review_status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_access_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `source_key` text NOT NULL,
  `requested_source_record_key` text,
  `source_record_id` text,
  `requested_project_id` text,
  `project_id` text,
  `buildertrend_job_id` text,
  `buildertrend_lead_id` text,
  `buildertrend_contact_id` text,
  `buildertrend_access_role` text,
  `contact_name` text NOT NULL,
  `company_name` text,
  `email` text,
  `phone` text,
  `proposed_contact_type` text DEFAULT 'vendor' NOT NULL,
  `proposed_project_role` text,
  `matched_user_id` text,
  `matched_customer_id` text,
  `matched_vendor_id` text,
  `match_status` text DEFAULT 'unmatched' NOT NULL,
  `match_confidence` real DEFAULT 0 NOT NULL,
  `portal_access_status` text DEFAULT 'not_granted' NOT NULL,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `source_notes` text,
  `review_notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_record_id`) REFERENCES `buildertrend_staging_records`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_staging_access_org_key_unique` ON `buildertrend_staging_access_candidates` (`organization_id`, `source_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_access_source_idx` ON `buildertrend_staging_access_candidates` (`source_record_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_access_project_idx` ON `buildertrend_staging_access_candidates` (`project_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_access_contact_idx` ON `buildertrend_staging_access_candidates` (`buildertrend_contact_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_access_review_idx` ON `buildertrend_staging_access_candidates` (`organization_id`, `review_status`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_access_portal_idx` ON `buildertrend_staging_access_candidates` (`organization_id`, `portal_access_status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `import_run_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `entity_kind` text NOT NULL,
  `entity_key` text NOT NULL,
  `entity_id` text NOT NULL,
  `observed_payload_json` text NOT NULL,
  `observed_at` text NOT NULL,
  FOREIGN KEY (`import_run_id`) REFERENCES `buildertrend_staging_runs`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_staging_observations_run_entity_unique` ON `buildertrend_staging_observations` (`import_run_id`, `entity_kind`, `entity_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_staging_observations_entity_idx` ON `buildertrend_staging_observations` (`organization_id`, `entity_kind`, `entity_id`);
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_observations_update_guard`
BEFORE UPDATE ON `buildertrend_staging_observations`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend staging observations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_observations_delete_guard`
BEFORE DELETE ON `buildertrend_staging_observations`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend staging observations cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_records_delete_guard`
BEFORE DELETE ON `buildertrend_staging_records`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'record' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend staging records cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_records_id_guard`
BEFORE UPDATE OF `id` ON `buildertrend_staging_records`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'record' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend staging record IDs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_files_delete_guard`
BEFORE DELETE ON `buildertrend_staging_files`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'file' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend staging files cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_files_id_guard`
BEFORE UPDATE OF `id` ON `buildertrend_staging_files`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'file' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend staging file IDs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_access_delete_guard`
BEFORE DELETE ON `buildertrend_staging_access_candidates`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'access_candidate' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend access candidates cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_staging_access_id_guard`
BEFORE UPDATE OF `id` ON `buildertrend_staging_access_candidates`
WHEN EXISTS (
  SELECT 1 FROM `buildertrend_staging_observations`
  WHERE `entity_kind` = 'access_candidate' AND `entity_id` = OLD.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'observed Buildertrend access candidate IDs are immutable');
END;
