ALTER TABLE `project_operations` ADD COLUMN `sage_job_id` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_job_number` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_vendor_id` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_vendor_name` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_phase_code` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_cost_code` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_tax_group` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_ship_to` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_order_date` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_required_date` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_write_status` text DEFAULT 'not_ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `sage_payload_json` text;
--> statement-breakpoint
CREATE TABLE `project_purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_record_id` text,
	`line_number` integer DEFAULT 1 NOT NULL,
	`cost_code` text,
	`phase_code` text,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`unit` text,
	`amount` real DEFAULT 0 NOT NULL,
	`tax_group` text,
	`sage_payload_json` text,
	`sync_status` text DEFAULT 'pending_sage' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_po_lines_operation` ON `project_purchase_order_lines` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_po_lines_project` ON `project_purchase_order_lines` (`project_id`);
