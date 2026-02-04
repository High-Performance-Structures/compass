CREATE TABLE `credit_memos` (
	`id` text PRIMARY KEY NOT NULL,
	`netsuite_id` text,
	`customer_id` text NOT NULL,
	`project_id` text,
	`memo_number` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`amount_applied` real DEFAULT 0 NOT NULL,
	`amount_remaining` real DEFAULT 0 NOT NULL,
	`memo` text,
	`line_items` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`netsuite_id` text,
	`customer_id` text NOT NULL,
	`project_id` text,
	`invoice_number` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`amount_due` real DEFAULT 0 NOT NULL,
	`memo` text,
	`line_items` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `netsuite_auth` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`expires_in` integer NOT NULL,
	`token_type` text NOT NULL,
	`issued_at` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `netsuite_sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_type` text NOT NULL,
	`record_type` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`records_processed` integer DEFAULT 0 NOT NULL,
	`records_failed` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `netsuite_sync_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`local_table` text NOT NULL,
	`local_record_id` text NOT NULL,
	`netsuite_record_type` text NOT NULL,
	`netsuite_internal_id` text,
	`last_synced_at` text,
	`last_modified_local` text,
	`last_modified_remote` text,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`conflict_data` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`netsuite_id` text,
	`customer_id` text,
	`vendor_id` text,
	`project_id` text,
	`payment_type` text NOT NULL,
	`amount` real NOT NULL,
	`payment_date` text NOT NULL,
	`payment_method` text,
	`reference_number` text,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vendor_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`netsuite_id` text,
	`vendor_id` text NOT NULL,
	`project_id` text,
	`bill_number` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`bill_date` text NOT NULL,
	`due_date` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`amount_due` real DEFAULT 0 NOT NULL,
	`memo` text,
	`line_items` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `netsuite_id` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `netsuite_job_id` text;--> statement-breakpoint
ALTER TABLE `vendors` ADD `netsuite_id` text;--> statement-breakpoint
ALTER TABLE `vendors` ADD `updated_at` text;