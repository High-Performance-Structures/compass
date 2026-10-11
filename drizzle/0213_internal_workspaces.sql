-- Internal workspaces: projects that are not client jobs (office duties,
-- yard and generic order work) and a duty log for them.
ALTER TABLE `projects` ADD `workspace_kind` text;
--> statement-breakpoint
CREATE TABLE `internal_duty_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`user_id` text,
	`duty_code` text NOT NULL,
	`duty_label` text NOT NULL,
	`hours` real,
	`notes` text,
	`related_project_id` text,
	`daily_log_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`related_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `internal_duty_entries_project_date_idx` ON `internal_duty_entries` (`project_id`,`entry_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_duty_entries_daily_log_idx` ON `internal_duty_entries` (`daily_log_id`);
--> statement-breakpoint
-- H-Office becomes an office workspace and Kiowa Yard a field workspace.
UPDATE `projects` SET `workspace_kind` = 'office' WHERE `id` = 'proj-h-office';
--> statement-breakpoint
UPDATE `projects` SET `workspace_kind` = 'field' WHERE `id` = 'proj-bt-kiowa-yard';
