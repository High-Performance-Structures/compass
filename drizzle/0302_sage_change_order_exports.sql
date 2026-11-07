-- Change orders and variances sent to Sage as approved prime change orders,
-- and a read-only copy of Sage's prime change orders per linked job.
-- Additive only.
CREATE TABLE IF NOT EXISTS `sage_change_order_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`change_order_id` text NOT NULL REFERENCES `project_change_orders`(`id`) ON DELETE cascade,
	`status` text DEFAULT 'queued' NOT NULL,
	`sage_change_order_number` text NOT NULL,
	`payload_json` text NOT NULL,
	`requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`requested_at` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`sage_record_id` text,
	`error_message` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sage_change_order_exports_change_order_idx` ON `sage_change_order_exports` (`change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_change_order_exports_claim_idx` ON `sage_change_order_exports` (`status`,`claimed_at`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_change_order_exports_project_idx` ON `sage_change_order_exports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_change_order_exports_organization_id_idx` ON `sage_change_order_exports` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_change_order_exports_requested_by_user_id_idx` ON `sage_change_order_exports` (`requested_by_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sage_prime_change_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`sage_record_id` text NOT NULL,
	`sage_job_number` text NOT NULL,
	`change_order_number` text NOT NULL,
	`change_order_date` text,
	`description` text NOT NULL,
	`sage_status_number` integer,
	`approved_amount_cents` integer NOT NULL,
	`approved_date` text,
	`lines_json` text NOT NULL,
	`captured_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sage_prime_change_orders_project_record_idx` ON `sage_prime_change_orders` (`project_id`,`sage_record_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sage_prime_change_order_reads` (
	`project_id` text PRIMARY KEY NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`sage_job_number` text NOT NULL,
	`change_order_count` integer NOT NULL,
	`captured_at` text NOT NULL
);
