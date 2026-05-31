CREATE TABLE `project_contact_source_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_contact_id` text,
	`source_system` text NOT NULL,
	`source_record_type` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_record_number` text,
	`source_label` text NOT NULL,
	`source_name` text NOT NULL,
	`match_status` text DEFAULT 'unmatched' NOT NULL,
	`match_confidence` real DEFAULT 0 NOT NULL,
	`match_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_contact_id`) REFERENCES `project_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_contact_source_links_project` ON `project_contact_source_links` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_contact_source_links_contact` ON `project_contact_source_links` (`project_contact_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_contact_source_links_source` ON `project_contact_source_links` (`source_system`,`source_record_type`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_contact_source_links_status` ON `project_contact_source_links` (`project_id`,`match_status`);
