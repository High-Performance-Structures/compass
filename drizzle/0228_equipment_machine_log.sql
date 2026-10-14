-- Machine log: company machines (linked to rate book entries), their service
-- schedules, and log entries (hours on a job, fuel, maintenance, repairs).
CREATE TABLE `equipment_machines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`sage_equipment_number` text,
	`rate_book_entry_id` text,
	`standby_rate_cents` integer,
	`idle_rate_cents` integer,
	`hour_meter` real,
	`hour_meter_on` text,
	`location_project_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rate_book_entry_id`) REFERENCES `rate_book_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `equipment_machines_org_idx` ON `equipment_machines` (`organization_id`,`active`);
--> statement-breakpoint
CREATE TABLE `equipment_service_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`name` text NOT NULL,
	`every_hours` real,
	`every_days` integer,
	`last_done_hours` real,
	`last_done_on` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `equipment_machines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `equipment_service_items_machine_idx` ON `equipment_service_items` (`machine_id`);
--> statement-breakpoint
CREATE TABLE `equipment_log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`kind` text NOT NULL,
	`entry_date` text NOT NULL,
	`project_id` text,
	`operator_user_id` text,
	`operator_name` text,
	`cost_code` text,
	`running_hours` real,
	`standby_hours` real,
	`idle_hours` real,
	`hour_meter` real,
	`gallons` real,
	`amount_cents` integer,
	`vendor` text,
	`paid_with` text,
	`service_item_id` text,
	`shop_hours` real,
	`running_rate_cents` integer,
	`standby_rate_cents` integer,
	`idle_rate_cents` integer,
	`charge_cents` integer,
	`notes` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`client_submission_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`machine_id`) REFERENCES `equipment_machines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_item_id`) REFERENCES `equipment_service_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `equipment_log_entries_org_date_idx` ON `equipment_log_entries` (`organization_id`,`entry_date`);
--> statement-breakpoint
CREATE INDEX `equipment_log_entries_machine_idx` ON `equipment_log_entries` (`machine_id`,`entry_date`);
--> statement-breakpoint
CREATE INDEX `equipment_log_entries_status_idx` ON `equipment_log_entries` (`organization_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_log_entries_submission_idx` ON `equipment_log_entries` (`client_submission_id`);
