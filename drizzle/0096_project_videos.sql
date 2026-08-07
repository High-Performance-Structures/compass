CREATE TABLE `project_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`department` text NOT NULL,
	`youtube_channel_key` text NOT NULL,
	`compass_audience` text DEFAULT 'staff' NOT NULL,
	`youtube_privacy` text DEFAULT 'private' NOT NULL,
	`publish_status` text DEFAULT 'pending_review' NOT NULL,
	`source_system` text NOT NULL,
	`source_external_id` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_mime_type` text NOT NULL,
	`source_file_size` integer DEFAULT 0 NOT NULL,
	`drive_file_id` text NOT NULL,
	`drive_url` text,
	`linked_entity_type` text,
	`linked_entity_id` text,
	`youtube_video_id` text,
	`youtube_url` text,
	`youtube_upload_session_url` text,
	`upload_error` text,
	`submitted_by_name` text,
	`submitted_by_email` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`published_at` text,
	`archived_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_videos_source_unique` ON `project_videos` (`source_system`,`source_external_id`);
--> statement-breakpoint
CREATE INDEX `project_videos_project_created_idx` ON `project_videos` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_videos_org_status_idx` ON `project_videos` (`organization_id`,`publish_status`,`created_at`);
