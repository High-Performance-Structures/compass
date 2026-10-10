-- Project paper trail: a readable copy of each Compass record in the
-- project's Google Drive folder. Edits only mark a record as due; a scheduled
-- job renders and writes it after a quiet period, so saving never runs on the
-- request path.
CREATE TABLE `project_record_drive_files` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` text NOT NULL,
	`changed_at` text NOT NULL,
	`source_changed_at` text,
	`last_synced_at` text,
	`drive_file_id` text,
	`drive_folder_id` text,
	`in_private_folder` integer DEFAULT 0 NOT NULL,
	`file_name` text,
	`content_version` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_record_drive_files_record_idx` ON `project_record_drive_files` (`record_type`,`record_id`);
--> statement-breakpoint
CREATE INDEX `project_record_drive_files_due_idx` ON `project_record_drive_files` (`status`,`due_at`);
--> statement-breakpoint
CREATE INDEX `project_record_drive_files_project_idx` ON `project_record_drive_files` (`project_id`);
--> statement-breakpoint
-- Frozen copies taken at milestones (PO sent, estimate signed, change order
-- approved, RFI answered). Never overwritten.
CREATE TABLE `project_record_drive_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` text NOT NULL,
	`milestone` text NOT NULL,
	`milestone_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text NOT NULL,
	`saved_at` text,
	`drive_file_id` text,
	`file_name` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_record_drive_snapshots_due_idx` ON `project_record_drive_snapshots` (`status`,`requested_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_record_drive_snapshots_record_idx` ON `project_record_drive_snapshots` (`record_type`,`record_id`,`milestone`,`milestone_at`);
--> statement-breakpoint
-- Whether a Drive folder is shared outside the company, cached so the job
-- does not ask Google on every save.
CREATE TABLE `drive_folder_share_checks` (
	`folder_id` text PRIMARY KEY NOT NULL,
	`shared_outside` integer NOT NULL,
	`checked_at` text NOT NULL
);
