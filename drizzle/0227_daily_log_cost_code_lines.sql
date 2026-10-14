-- Daily logs can record several cost codes, each with its time and a short
-- description. They are stored as duty entries linked to the log, so a log
-- may now have more than one; sort_order keeps them in the order entered.
DROP INDEX IF EXISTS `internal_duty_entries_daily_log_idx`;
--> statement-breakpoint
CREATE INDEX `internal_duty_entries_daily_log_idx` ON `internal_duty_entries` (`daily_log_id`);
--> statement-breakpoint
ALTER TABLE `internal_duty_entries` ADD `sort_order` integer DEFAULT 0 NOT NULL;
