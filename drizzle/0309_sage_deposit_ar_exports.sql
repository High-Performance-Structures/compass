-- Deposit requests sent to Sage as their own AR invoices (<job>-DEP1), through
-- the same writer as simple invoices. Additive only.
CREATE TABLE IF NOT EXISTS `sage_deposit_ar_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`deposit_id` text NOT NULL REFERENCES `project_contract_deposits`(`id`) ON DELETE cascade,
	`status` text DEFAULT 'queued' NOT NULL,
	`invoice_number` text NOT NULL,
	`requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`requested_at` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`sage_record_id` text,
	`sage_total_cents` integer,
	`error_message` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sage_deposit_ar_exports_deposit_idx` ON `sage_deposit_ar_exports` (`deposit_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_deposit_ar_exports_claim_idx` ON `sage_deposit_ar_exports` (`status`,`claimed_at`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_deposit_ar_exports_project_idx` ON `sage_deposit_ar_exports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_deposit_ar_exports_organization_id_idx` ON `sage_deposit_ar_exports` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_deposit_ar_exports_requested_by_user_id_idx` ON `sage_deposit_ar_exports` (`requested_by_user_id`);
