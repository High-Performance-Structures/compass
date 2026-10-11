-- Shop tickets: company labor and machine hours billed to a project at set rates.
CREATE TABLE `shop_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`ticket_number` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ticket_date` text NOT NULL,
	`labor_from` text,
	`labor_to` text,
	`pay_application_number` integer,
	`pay_application_month` text,
	`budget_application_id` text,
	`notes` text,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`budget_reviewed_by` text,
	`budget_reviewed_at` text,
	`issued_by` text,
	`issued_at` text,
	`voided_by` text,
	`voided_at` text,
	`void_reason` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_application_id`) REFERENCES `project_budget_applications`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`budget_reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_tickets_org_sequence_idx` ON `shop_tickets` (`organization_id`,`sequence_number`);
--> statement-breakpoint
CREATE INDEX `shop_tickets_project_idx` ON `shop_tickets` (`project_id`,`status`);
--> statement-breakpoint
CREATE TABLE `shop_ticket_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`cost_code` text NOT NULL,
	`description` text NOT NULL,
	`rate_kind` text NOT NULL,
	`hours` real NOT NULL,
	`rate_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`rate_book_entry_id` text,
	`outside_budget` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `shop_tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shop_ticket_lines_ticket_idx` ON `shop_ticket_lines` (`ticket_id`,`line_number`);
