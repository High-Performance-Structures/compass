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
-- H-Office's recurring duties, owned by the office manager. One insert per
-- duty (D1 limits compound selects); each is skipped when H-Office is absent.
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-fsb', p.organization_id, p.id, 'Bank reconciliation', 'FSB', 'monthly', 15, '502', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 1, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-fsb-project', p.organization_id, p.id, 'Bank reconciliation', 'FSB Project', 'monthly', 15, '502', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 2, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-ppcu-checking', p.organization_id, p.id, 'Bank reconciliation', 'PPCU Checking', 'monthly', 15, '502', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 3, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-ppcu-savings', p.organization_id, p.id, 'Bank reconciliation', 'PPCU Savings', 'monthly', 15, '502', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 4, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-spark-card', p.organization_id, p.id, 'Statement reconciliation', 'Spark Credit Card', 'monthly', 15, '502', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 5, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-sales-tax', p.organization_id, p.id, 'Sales tax filing', NULL, 'monthly', 20, '501', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 6, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
INSERT INTO `recurring_duties` (`id`,`organization_id`,`project_id`,`title`,`account_name`,`cadence`,`due_day`,`duty_code`,`owner_user_id`,`active`,`sort_order`,`created_at`,`updated_at`)
SELECT 'rduty-hoffice-vendor-statements', p.organization_id, p.id, 'Vendor statement review', NULL, 'monthly', 31, '512', (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 1, 7, '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z'
FROM `projects` p WHERE p.id = 'proj-h-office';
--> statement-breakpoint
-- FSB April 2026 was reconciled on Sep 28 (H-Office daily log).
INSERT INTO `recurring_duty_completions` (`id`,`recurring_duty_id`,`period`,`completed_on`,`completed_by`,`notes`,`created_at`)
SELECT 'rdone-hoffice-fsb-2026-04', 'rduty-hoffice-fsb', '2026-04', '2026-09-28',
  (SELECT u.id FROM users u WHERE u.id = 'user_01KGSRW8957M25E2YJ1XTMS74Q'), 'From the H-Office daily log: "reconciled FSB Apr 2026".', '2026-10-11T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM `recurring_duties` WHERE id = 'rduty-hoffice-fsb');
