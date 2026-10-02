CREATE TABLE `project_families` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`client_name` text,
	`address` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`google_drive_folder_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_families_org_status_idx` ON `project_families` (`organization_id`,`status`,`name`);
--> statement-breakpoint
CREATE INDEX `project_families_org_name_idx` ON `project_families` (`organization_id`,`name`);
--> statement-breakpoint
CREATE TABLE `project_family_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text,
	`project_number` text,
	`google_drive_folder_id` text,
	`sequence` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`job_status_id` text DEFAULT 'awaiting_funding' NOT NULL,
	`originating_change_order_id` text,
	`authorized_contract_amount_cents` integer,
	`authorized_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `project_families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`originating_change_order_id`) REFERENCES `project_change_orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_family_phases_family_sequence_unique` ON `project_family_phases` (`family_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_family_phases_project_unique` ON `project_family_phases` (`project_id`);
--> statement-breakpoint
CREATE INDEX `project_family_phases_project_number_idx` ON `project_family_phases` (`project_number`);
--> statement-breakpoint
CREATE INDEX `project_family_phases_family_status_idx` ON `project_family_phases` (`family_id`,`job_status_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `project_family_phases_originating_change_order_idx` ON `project_family_phases` (`originating_change_order_id`);
