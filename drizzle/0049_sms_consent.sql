ALTER TABLE `notification_preferences` ADD `sms_consent_accepted` integer DEFAULT 0 NOT NULL;
ALTER TABLE `notification_preferences` ADD `sms_consent_accepted_at` text;
ALTER TABLE `notification_preferences` ADD `sms_consent_disclosure_url` text;
ALTER TABLE `notification_preferences` ADD `sms_consent_disclosure_version` text;
ALTER TABLE `notification_preferences` ADD `sms_consent_phone_number` text;
