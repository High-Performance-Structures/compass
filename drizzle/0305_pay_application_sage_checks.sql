-- The Sage check of pay requests built in Sage (posted AR invoice vs the pay request).
-- Additive only.
CREATE TABLE IF NOT EXISTS `pay_application_sage_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE cascade,
	`snapshot_id` text NOT NULL REFERENCES `sage_pay_application_snapshots`(`id`) ON DELETE cascade,
	`status` text NOT NULL,
	`fingerprint` text NOT NULL,
	`findings_json` text NOT NULL,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_checks_application_idx` ON `pay_application_sage_checks` (`application_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_checks_project_idx` ON `pay_application_sage_checks` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_checks_snapshot_idx` ON `pay_application_sage_checks` (`snapshot_id`);
