CREATE TABLE `buildertrend_import_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `source_method` text NOT NULL,
  `source_label` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `started_by` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  `raw_artifact_drive_file_id` text,
  `raw_artifact_drive_url` text,
  `notes` text,
  `summary_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_import_runs_org` ON `buildertrend_import_runs` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_import_runs_status` ON `buildertrend_import_runs` (`status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_source_records` (
  `id` text PRIMARY KEY NOT NULL,
  `import_run_id` text NOT NULL,
  `organization_id` text,
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
  `archive_drive_folder_id` text,
  `archive_drive_file_id` text,
  `archive_drive_url` text,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `promotion_status` text DEFAULT 'archive_only' NOT NULL,
  `promoted_record_type` text,
  `promoted_record_id` text,
  `sage_reconciliation_status` text DEFAULT 'not_reviewed' NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`import_run_id`) REFERENCES `buildertrend_import_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_run` ON `buildertrend_source_records` (`import_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_project` ON `buildertrend_source_records` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_job` ON `buildertrend_source_records` (`buildertrend_job_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_lead` ON `buildertrend_source_records` (`buildertrend_lead_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_type` ON `buildertrend_source_records` (`source_record_type`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_review` ON `buildertrend_source_records` (`review_status`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_source_records_promotion` ON `buildertrend_source_records` (`promotion_status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_archive_files` (
  `id` text PRIMARY KEY NOT NULL,
  `import_run_id` text NOT NULL,
  `source_record_id` text,
  `organization_id` text,
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
  `drive_folder_id` text,
  `drive_file_id` text,
  `drive_url` text,
  `thumbnail_drive_file_id` text,
  `thumbnail_url` text,
  `checksum` text,
  `captured_at` text,
  `visibility` text DEFAULT 'internal' NOT NULL,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `metadata_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`import_run_id`) REFERENCES `buildertrend_import_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_record_id`) REFERENCES `buildertrend_source_records`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_run` ON `buildertrend_archive_files` (`import_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_source` ON `buildertrend_archive_files` (`source_record_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_project` ON `buildertrend_archive_files` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_job` ON `buildertrend_archive_files` (`buildertrend_job_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_lead` ON `buildertrend_archive_files` (`buildertrend_lead_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_archive_files_review` ON `buildertrend_archive_files` (`review_status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_access_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `import_run_id` text NOT NULL,
  `source_record_id` text,
  `organization_id` text,
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
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`import_run_id`) REFERENCES `buildertrend_import_runs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_record_id`) REFERENCES `buildertrend_source_records`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_access_candidates_run` ON `buildertrend_access_candidates` (`import_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_access_candidates_project` ON `buildertrend_access_candidates` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_access_candidates_contact` ON `buildertrend_access_candidates` (`buildertrend_contact_id`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_access_candidates_review` ON `buildertrend_access_candidates` (`review_status`);
--> statement-breakpoint
CREATE INDEX `idx_buildertrend_access_candidates_portal` ON `buildertrend_access_candidates` (`portal_access_status`);
