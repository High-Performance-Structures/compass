-- Every manufacturer invoice, freight invoice and credit memo on a Nu-Tech
-- order. One PO often carries several (one had eight, plus a credit memo, and
-- freight comes from its own carrier). A blank vendor is the manufacturer.
-- The order's old single invoice-number field stays as written history.
CREATE TABLE `nutech_order_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`vendor_id` text,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`invoice_number` text NOT NULL,
	`amount_cents` integer,
	`received_on` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `nutech_order_workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_order_invoices_workflow_number_uq` ON `nutech_order_invoices` (`workflow_id`, `invoice_number`);
--> statement-breakpoint
CREATE INDEX `nutech_order_invoices_vendor_id_idx` ON `nutech_order_invoices` (`vendor_id`);
--> statement-breakpoint
CREATE INDEX `nutech_order_invoices_created_by_idx` ON `nutech_order_invoices` (`created_by`);
