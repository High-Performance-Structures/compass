-- Missing daily log reminders: one per person per day, so the scheduled job
-- never reminds twice; and an optional personal reminder time a person can
-- pick when the company allows it.
CREATE TABLE `daily_log_reminders` (
	`user_id` text NOT NULL,
	`reminder_date` text NOT NULL,
	`organization_id` text NOT NULL,
	`reminded_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `reminder_date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_log_reminders_org_date_idx` ON `daily_log_reminders` (`organization_id`,`reminder_date`);
--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `daily_log_reminder_time` text;
