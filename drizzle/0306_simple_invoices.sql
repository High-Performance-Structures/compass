-- Simple invoices built in Compass (Nu-Tech sales from an estimate, one-off
-- work): new columns on invoices, their lines, and their Sage AR invoice
-- exports. Additive only.
ALTER TABLE `invoices` ADD COLUMN `invoice_kind` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `sequence_number` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `estimate_id` text REFERENCES `project_estimates`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `tax_entity_id` text REFERENCES `sage_tax_entities`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `title` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `is_deposit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `price_mode` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `price_customer_type` text DEFAULT 'returning' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_state` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_invoice_id` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_order_id` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_customer_id` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_public_url` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `square_error` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `finalized_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `finalized_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `emailed_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `emailed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `voided_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `voided_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `void_reason` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `created_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invoices_project_kind_sequence_unique` ON `invoices` (`project_id`,`invoice_kind`,`sequence_number`) WHERE "invoices"."invoice_kind" IS NOT NULL AND "invoices"."sequence_number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_estimate_id_idx` ON `invoices` (`estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_tax_entity_id_idx` ON `invoices` (`tax_entity_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_finalized_by_user_id_idx` ON `invoices` (`finalized_by_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_emailed_by_user_id_idx` ON `invoices` (`emailed_by_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_voided_by_user_id_idx` ON `invoices` (`voided_by_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoices_created_by_user_id_idx` ON `invoices` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL REFERENCES `invoices`(`id`) ON DELETE cascade,
	`sort_order` integer NOT NULL,
	`source` text NOT NULL,
	`estimate_line_id` text REFERENCES `project_estimate_lines`(`id`) ON DELETE set null,
	`nutech_product_id` text REFERENCES `nutech_products`(`id`) ON DELETE set null,
	`cost_code` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'EA' NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`taxable` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_lines_estimate_line_id_idx` ON `invoice_lines` (`estimate_line_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_lines_nutech_product_id_idx` ON `invoice_lines` (`nutech_product_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sage_invoice_ar_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`invoice_id` text NOT NULL REFERENCES `invoices`(`id`) ON DELETE cascade,
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
CREATE UNIQUE INDEX IF NOT EXISTS `sage_invoice_ar_exports_invoice_idx` ON `sage_invoice_ar_exports` (`invoice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_invoice_ar_exports_claim_idx` ON `sage_invoice_ar_exports` (`status`,`claimed_at`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_invoice_ar_exports_project_idx` ON `sage_invoice_ar_exports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_invoice_ar_exports_organization_id_idx` ON `sage_invoice_ar_exports` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_invoice_ar_exports_requested_by_user_id_idx` ON `sage_invoice_ar_exports` (`requested_by_user_id`);
