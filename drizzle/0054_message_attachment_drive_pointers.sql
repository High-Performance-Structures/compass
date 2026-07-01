ALTER TABLE `message_attachments` ADD `storage_provider` text DEFAULT 'google_drive' NOT NULL;
--> statement-breakpoint
ALTER TABLE `message_attachments` ADD `drive_file_id` text;
--> statement-breakpoint
ALTER TABLE `message_attachments` ADD `drive_url` text;
--> statement-breakpoint
ALTER TABLE `message_attachments` ADD `download_url` text;
