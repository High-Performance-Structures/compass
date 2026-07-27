ALTER TABLE `notification_preferences` ADD `timezone` text DEFAULT 'America/Denver' NOT NULL;
ALTER TABLE `notification_preferences` ADD `sms_enabled` integer DEFAULT 0 NOT NULL;
ALTER TABLE `notification_preferences` ADD `sms_phone_number` text;
ALTER TABLE `notification_preferences` ADD `mention_email_enabled` integer DEFAULT 1 NOT NULL;
ALTER TABLE `notification_preferences` ADD `mention_sms_enabled` integer DEFAULT 0 NOT NULL;
ALTER TABLE `notification_preferences` ADD `announcement_email_enabled` integer DEFAULT 1 NOT NULL;
ALTER TABLE `notification_preferences` ADD `announcement_sms_enabled` integer DEFAULT 0 NOT NULL;
ALTER TABLE `notification_recipients` ADD `sms` integer DEFAULT 0 NOT NULL;
