-- Accepted estimates synced to Sage as the job's proposal (and budget), and a
-- read-only summary of each linked job's Sage proposal. Additive only.
CREATE TABLE IF NOT EXISTS `sage_estimate_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`estimate_id` text NOT NULL REFERENCES `project_estimates`(`id`) ON DELETE cascade,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`automatic` integer DEFAULT true NOT NULL,
	`requested_at` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`error_message` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sage_estimate_exports_estimate_idx` ON `sage_estimate_exports` (`estimate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_estimate_exports_claim_idx` ON `sage_estimate_exports` (`status`,`claimed_at`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_estimate_exports_project_idx` ON `sage_estimate_exports` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_estimate_exports_organization_id_idx` ON `sage_estimate_exports` (`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_estimate_exports_requested_by_user_id_idx` ON `sage_estimate_exports` (`requested_by_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sage_job_proposal_reads` (
	`project_id` text PRIMARY KEY NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`sage_job_number` text NOT NULL,
	`line_count` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`lines_json` text NOT NULL,
	`captured_at` text NOT NULL
);
