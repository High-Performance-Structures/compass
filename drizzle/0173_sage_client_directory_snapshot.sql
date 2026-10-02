-- Sage client listings are read-only evidence, never Compass customer rows.
CREATE TABLE `sage_client_directory_refreshes` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `status` text NOT NULL DEFAULT 'queued',
  `claim_token` text,
  `claimed_at` text,
  `requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `requested_at` text NOT NULL,
  `completed_at` text,
  `error_message` text
);
--> statement-breakpoint
CREATE INDEX `sage_client_directory_refresh_org_status_idx` ON `sage_client_directory_refreshes` (`organization_id`, `status`, `requested_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_client_directory_active_org_unique` ON `sage_client_directory_refreshes` (`organization_id`) WHERE `status` IN ('queued', 'running');
--> statement-breakpoint
CREATE TABLE `sage_client_directory_entries` (
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `sage_record_id` text NOT NULL,
  `sage_client_number` text NOT NULL,
  `name` text NOT NULL,
  `email` text,
  `captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_client_directory_org_id_unique` ON `sage_client_directory_entries` (`organization_id`, `sage_record_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_client_directory_org_number_unique` ON `sage_client_directory_entries` (`organization_id`, `sage_client_number`);
--> statement-breakpoint
CREATE INDEX `sage_client_directory_org_name_idx` ON `sage_client_directory_entries` (`organization_id`, `name`);
