ALTER TABLE `daily_log_photos` ADD `sub_vendor_visible` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `daily_log_photos` ADD `public_shareable` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `daily_log_photos` ADD `photo_kind` text DEFAULT 'progress' NOT NULL;
