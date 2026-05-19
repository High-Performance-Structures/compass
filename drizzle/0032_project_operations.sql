CREATE TABLE `project_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_system` text DEFAULT 'sage' NOT NULL,
	`source_record_type` text NOT NULL,
	`source_record_id` text,
	`source_record_number` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assignee_type` text,
	`assignee_name` text,
	`company_name` text,
	`cost_code` text,
	`start_date` text,
	`due_date` text,
	`amount` real,
	`external_url` text,
	`sync_direction` text DEFAULT 'read' NOT NULL,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_operations_project` ON `project_operations` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_operations_source` ON `project_operations` (`source_system`,`source_record_type`);
--> statement-breakpoint
CREATE INDEX `idx_project_operations_due` ON `project_operations` (`project_id`,`due_date`);
