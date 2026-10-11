-- Recurring duties for internal workspaces (monthly reconciliations, sales tax,
-- vendor statements) and the periods marked done.
CREATE TABLE `recurring_duties` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`account_name` text,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`due_day` integer DEFAULT 15 NOT NULL,
	`duty_code` text,
	`owner_user_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recurring_duties_project_idx` ON `recurring_duties` (`project_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `recurring_duty_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_duty_id` text NOT NULL,
	`period` text NOT NULL,
	`completed_on` text NOT NULL,
	`completed_by` text,
	`notes` text,
	`duty_entry_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recurring_duty_id`) REFERENCES `recurring_duties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duty_entry_id`) REFERENCES `internal_duty_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_duty_completions_period_idx` ON `recurring_duty_completions` (`recurring_duty_id`,`period`);
--> statement-breakpoint
-- H-Office's recurring duties, owned by the office manager. Only rows whose
-- workspace and owner exist are inserted, so other databases are unaffected.
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT d.id, p.organization_id, p.id, d.title, d.account, 'monthly', d.due_day, d.code,
  (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, d.sort_order, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM (
  SELECT 'rduty-hoffice-fsb' AS id, 'Bank reconciliation' AS title, 'FSB' AS account, 15 AS due_day, '502' AS code, 1 AS sort_order
  UNION ALL SELECT 'rduty-hoffice-fsb-project', 'Bank reconciliation', 'FSB Project', 15, '502', 2
  UNION ALL SELECT 'rduty-hoffice-ppcu-checking', 'Bank reconciliation', 'PPCU Checking', 15, '502', 3
  UNION ALL SELECT 'rduty-hoffice-ppcu-savings', 'Bank reconciliation', 'PPCU Savings', 15, '502', 4
  UNION ALL SELECT 'rduty-hoffice-spark-card', 'Statement reconciliation', 'Spark Credit Card', 15, '502', 5
  UNION ALL SELECT 'rduty-hoffice-sales-tax', 'Sales tax filing', NULL, 20, '501', 6
  UNION ALL SELECT 'rduty-hoffice-vendor-statements', 'Vendor statement review', NULL, 31, '512', 7
) d
JOIN `projects` p ON p.id = 'proj-h-office';
--> statement-breakpoint
-- FSB April 2026 was reconciled on Sep 28 (H-Office daily log).
INSERT INTO `recurring_duty_completions` (`id`,`recurring_duty_id`,`period`,`completed_on`,`completed_by`,`notes`,`created_at`)
SELECT 'rdone-hoffice-fsb-2026-04', 'rduty-hoffice-fsb', '2026-04', '2026-09-28',
  (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 'From the H-Office daily log: "reconciled FSB Apr 2026".', '2026-10-11T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM `recurring_duties` WHERE id = 'rduty-hoffice-fsb');
