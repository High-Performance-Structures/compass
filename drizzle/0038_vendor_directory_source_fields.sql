ALTER TABLE `vendors` ADD `source_system` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `source_record_id` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `source_record_number` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `source_metadata` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `directory_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `sync_status` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `last_synced_at` text;
