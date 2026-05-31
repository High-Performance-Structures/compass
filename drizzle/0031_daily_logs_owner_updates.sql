CREATE TABLE `daily_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`author_id` text,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_external_id` text,
	`log_date` text NOT NULL,
	`weather_temp_f` integer,
	`weather_conditions` text,
	`weather_precipitation` text,
	`weather_source` text DEFAULT 'manual' NOT NULL,
	`work_completed` text NOT NULL,
	`issues` text,
	`materials_used` text,
	`crew_present` text,
	`hours_worked` real,
	`safety_incidents` text,
	`visitor_log` text,
	`notes` text,
	`is_client_visible` integer DEFAULT false NOT NULL,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`tags` text,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_log_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`daily_log_id` text,
	`uploaded_by` text,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_external_id` text,
	`file_name` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`drive_file_id` text,
	`drive_url` text,
	`thumbnail_url` text,
	`caption` text,
	`captured_at` text,
	`gps_lat` real,
	`gps_lng` real,
	`upload_status` text DEFAULT 'pending' NOT NULL,
	`review_status` text DEFAULT 'needs_review' NOT NULL,
	`owner_visible` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_log_task_links` (
	`id` text PRIMARY KEY NOT NULL,
	`daily_log_id` text NOT NULL,
	`schedule_task_id` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_task_id`) REFERENCES `schedule_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `owner_project_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_by` text,
	`title` text NOT NULL,
	`update_date` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`channel` text DEFAULT 'compass' NOT NULL,
	`source_daily_log_ids` text,
	`selected_photo_ids` text,
	`published_at` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_daily_logs_project_date` ON `daily_logs` (`project_id`,`log_date`);
--> statement-breakpoint
CREATE INDEX `idx_daily_logs_author` ON `daily_logs` (`author_id`);
--> statement-breakpoint
CREATE INDEX `idx_daily_logs_sync` ON `daily_logs` (`sync_status`);
--> statement-breakpoint
CREATE INDEX `idx_daily_log_photos_project` ON `daily_log_photos` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_daily_log_photos_log` ON `daily_log_photos` (`daily_log_id`);
--> statement-breakpoint
CREATE INDEX `idx_daily_log_photos_upload` ON `daily_log_photos` (`upload_status`);
--> statement-breakpoint
CREATE INDEX `idx_owner_project_updates_project_date` ON `owner_project_updates` (`project_id`,`update_date`);
