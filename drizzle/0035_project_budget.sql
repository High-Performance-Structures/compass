CREATE TABLE `project_budget_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_system` text DEFAULT 'sage' NOT NULL,
	`source_record_id` text,
	`application_number` text NOT NULL,
	`period_to` text,
	`status` text DEFAULT 'current' NOT NULL,
	`original_contract_sum` real DEFAULT 0 NOT NULL,
	`net_changes` real DEFAULT 0 NOT NULL,
	`contract_sum_to_date` real DEFAULT 0 NOT NULL,
	`total_completed_stored_to_date` real DEFAULT 0 NOT NULL,
	`retainage_held` real DEFAULT 0 NOT NULL,
	`total_earned_less_retainage` real DEFAULT 0 NOT NULL,
	`previous_certificates` real DEFAULT 0 NOT NULL,
	`current_payment_due` real DEFAULT 0 NOT NULL,
	`balance_to_finish` real DEFAULT 0 NOT NULL,
	`owner_visible` integer DEFAULT false NOT NULL,
	`source_url` text,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_applications_project` ON `project_budget_applications` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_applications_source` ON `project_budget_applications` (`source_system`,`source_record_id`);
--> statement-breakpoint
CREATE TABLE `project_budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`application_id` text,
	`source_system` text DEFAULT 'sage' NOT NULL,
	`source_record_id` text,
	`source_record_number` text,
	`cost_code` text NOT NULL,
	`csi_division` text NOT NULL,
	`csi_division_name` text NOT NULL,
	`description` text NOT NULL,
	`notes` text,
	`original_estimate` real DEFAULT 0 NOT NULL,
	`prior_changes` real DEFAULT 0 NOT NULL,
	`current_changes` real DEFAULT 0 NOT NULL,
	`total_changes` real DEFAULT 0 NOT NULL,
	`adjusted_estimate` real DEFAULT 0 NOT NULL,
	`prior_costs` real DEFAULT 0 NOT NULL,
	`current_costs` real DEFAULT 0 NOT NULL,
	`total_costs` real DEFAULT 0 NOT NULL,
	`percent_complete` real DEFAULT 0 NOT NULL,
	`balance_to_finish` real DEFAULT 0 NOT NULL,
	`retainage_held` real DEFAULT 0 NOT NULL,
	`vendor_name` text,
	`owner_label` text,
	`owner_visible` integer DEFAULT false NOT NULL,
	`internal_notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `project_budget_applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_lines_project` ON `project_budget_lines` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_lines_application` ON `project_budget_lines` (`application_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_lines_csi` ON `project_budget_lines` (`project_id`,`csi_division`);
--> statement-breakpoint
CREATE INDEX `idx_project_budget_lines_owner` ON `project_budget_lines` (`project_id`,`owner_visible`);
