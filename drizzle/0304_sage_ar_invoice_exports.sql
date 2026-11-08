-- Billed Compass pay requests sent to Sage as AR invoices (ARInvoiceAddRq).
-- Additive only.
CREATE TABLE IF NOT EXISTS `sage_ar_invoice_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE cascade,
	`status` text DEFAULT 'queued' NOT NULL,
	`invoice_number` text NOT NULL,
	`requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`automatic` integer DEFAULT true NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS `sage_ar_invoice_exports_application_idx` ON `sage_ar_invoice_exports` (`application_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_ar_invoice_exports_claim_idx` ON `sage_ar_invoice_exports` (`status`,`claimed_at`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_ar_invoice_exports_project_idx` ON `sage_ar_invoice_exports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_ar_invoice_exports_organization_id_idx` ON `sage_ar_invoice_exports` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_ar_invoice_exports_requested_by_user_id_idx` ON `sage_ar_invoice_exports` (`requested_by_user_id`);
