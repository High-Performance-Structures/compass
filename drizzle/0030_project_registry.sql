ALTER TABLE `projects` ADD `project_number` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_number` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `google_drive_folder_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `google_schedule_sheet_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `google_daily_log_sheet_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `google_calendar_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `buildertrend_project_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_updates_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_update_channel` text DEFAULT 'compass' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_update_cadence` text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `updated_at` text;--> statement-breakpoint
CREATE TABLE `project_external_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`system` text NOT NULL,
	`label` text NOT NULL,
	`external_id` text,
	`external_number` text,
	`external_url` text,
	`sync_direction` text DEFAULT 'read' NOT NULL,
	`sync_status` text DEFAULT 'unmapped' NOT NULL,
	`metadata` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_external_links_project_idx` ON `project_external_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_external_links_system_external_idx` ON `project_external_links` (`system`,`external_id`);
