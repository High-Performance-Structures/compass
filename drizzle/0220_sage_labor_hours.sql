-- Sage timecard hours for shop tickets (read-only from Sage). Compass queues a
-- request for a project's labor dates; the Sage bridge returns that job's
-- timecard lines. Claims record which hours went on which ticket so the same
-- hours are never billed twice.
CREATE TABLE `sage_labor_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`project_number` text,
	`sage_job_number` text,
	`date_from` text NOT NULL,
	`date_to` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`line_count` integer,
	`requested_by` text REFERENCES `users`(`id`) ON DELETE set null,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_labor_requests_status_idx` ON `sage_labor_requests` (`status`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_labor_requests_project_idx` ON `sage_labor_requests` (`project_id`, `requested_at`);
--> statement-breakpoint
CREATE TABLE `sage_labor_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`sage_job_number` text NOT NULL,
	`work_date` text NOT NULL,
	`hours` real NOT NULL,
	`sage_cost_code` text,
	`sage_cost_code_name` text,
	`employee_name` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_labor_lines_project_idx` ON `sage_labor_lines` (`project_id`, `work_date`);
--> statement-breakpoint
CREATE TABLE `shop_ticket_labor_claims` (
	`ticket_id` text NOT NULL REFERENCES `shop_tickets`(`id`) ON DELETE cascade,
	`labor_line_id` text NOT NULL REFERENCES `sage_labor_lines`(`id`) ON DELETE cascade,
	`hours` real NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`ticket_id`, `labor_line_id`)
);
--> statement-breakpoint
CREATE INDEX `shop_ticket_labor_claims_line_idx` ON `shop_ticket_labor_claims` (`labor_line_id`);
