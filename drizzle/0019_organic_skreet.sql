PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`daily_log_id` text,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`thumbnail_url` text,
	`drive_file_id` text,
	`name` text,
	`description` text,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_project_assets`("id", "project_id", "daily_log_id", "type", "url", "thumbnail_url", "drive_file_id", "name", "description", "uploaded_by", "created_at", "updated_at") SELECT "id", "project_id", "daily_log_id", "type", "url", "thumbnail_url", "drive_file_id", "name", "description", "uploaded_by", "created_at", "updated_at" FROM `project_assets`;--> statement-breakpoint
DROP TABLE `project_assets`;--> statement-breakpoint
ALTER TABLE `__new_project_assets` RENAME TO `project_assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `daily_logs` DROP COLUMN `updated_at`;