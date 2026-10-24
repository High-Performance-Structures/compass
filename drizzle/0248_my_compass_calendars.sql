-- "My Compass": a Google calendar in each staff member's own account that
-- Compass keeps filled with the schedule items and to-dos assigned to them.
-- Compass owns the content; the sync rewrites anything changed in Google.
CREATE TABLE `my_compass_calendars` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`enabled` integer NOT NULL DEFAULT 1,
	`other_names` text NOT NULL DEFAULT '[]',
	`google_email` text,
	`google_calendar_id` text,
	`status` text NOT NULL DEFAULT 'pending',
	`last_synced_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `my_compass_calendar_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`item_key` text NOT NULL,
	`google_event_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `my_compass_calendar_items_user_key` ON `my_compass_calendar_items` (`user_id`, `item_key`);
