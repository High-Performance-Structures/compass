CREATE TABLE `buildertrend_module_attestations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `import_run_id` text,
  `module_key` text NOT NULL,
  `status` text NOT NULL,
  `observed_count` integer DEFAULT 0 NOT NULL,
  `manifest_fingerprint` text NOT NULL,
  `evidence_drive_file_id` text,
  `evidence_drive_url` text,
  `source_label` text NOT NULL,
  `checked_at` text NOT NULL,
  `verified_by` text,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`import_run_id`) REFERENCES `buildertrend_staging_runs`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  CONSTRAINT `buildertrend_module_attestations_status_check`
    CHECK (`status` in ('captured', 'verified_empty', 'partial', 'blocked', 'unavailable')),
  CONSTRAINT `buildertrend_module_attestations_observed_count_check`
    CHECK (`observed_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_module_attestations_org_project_module_unique`
  ON `buildertrend_module_attestations` (`organization_id`, `project_id`, `module_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_module_attestations_org_status_idx`
  ON `buildertrend_module_attestations` (`organization_id`, `status`);
--> statement-breakpoint
CREATE INDEX `buildertrend_module_attestations_run_idx`
  ON `buildertrend_module_attestations` (`import_run_id`);
