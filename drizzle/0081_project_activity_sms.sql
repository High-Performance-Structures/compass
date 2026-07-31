ALTER TABLE `notification_preferences`
  ADD COLUMN `project_activity_sms_enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `notification_preferences`
  ADD COLUMN `sms_quiet_hours_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `notification_preferences`
  ADD COLUMN `sms_quiet_hours_start` text DEFAULT '21:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE `notification_preferences`
  ADD COLUMN `sms_quiet_hours_end` text DEFAULT '07:00' NOT NULL;
