CREATE TABLE `project_profile_sync_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `operation` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `payload_json` text NOT NULL,
  `error` text,
  `attempts` integer DEFAULT 0 NOT NULL,
  `attempted_at` text,
  `completed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `project_profile_sync_operations_project_status_idx` ON `project_profile_sync_operations` (`project_id`,`status`,`created_at`);
