-- Pay requests built in Sage and synced into Compass. Each owner pay
-- application records where its billed amounts come from (entered in Compass,
-- or synced from Sage and read only in Compass), and each Sage sync that
-- created, linked, refreshed or replaced a pay application's amounts is kept
-- with the read snapshot it used. Additive only: a new column with a default,
-- a new table and its indexes; no data changes, no table rebuilds.
ALTER TABLE `project_budget_applications` ADD `billing_source` text DEFAULT 'compass' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pay_application_sage_syncs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE CASCADE,
  `snapshot_id` text NOT NULL REFERENCES `sage_pay_application_snapshots`(`id`) ON DELETE CASCADE,
  `event_kind` text NOT NULL,
  `lines_before_snapshot` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pay_application_sage_syncs_event_idx`
  ON `pay_application_sage_syncs` (`application_id`, `snapshot_id`, `event_kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_syncs_project_idx`
  ON `pay_application_sage_syncs` (`project_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_syncs_snapshot_idx`
  ON `pay_application_sage_syncs` (`snapshot_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_sage_syncs_created_by_idx`
  ON `pay_application_sage_syncs` (`created_by`);
