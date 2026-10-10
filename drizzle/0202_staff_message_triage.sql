ALTER TABLE `staff_message_records` ADD COLUMN `status` text DEFAULT 'new' NOT NULL;
--> statement-breakpoint
ALTER TABLE `staff_message_records` ADD COLUMN `status_changed_at` text;
--> statement-breakpoint
ALTER TABLE `staff_message_records` ADD COLUMN `last_activity_at` text;
--> statement-breakpoint
ALTER TABLE `staff_message_records` ADD COLUMN `resolved_at` text;
--> statement-breakpoint
ALTER TABLE `staff_message_records` ADD COLUMN `resolved_by` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `staff_message_records_org_status_idx` ON `staff_message_records` (`organization_id`, `status`);
--> statement-breakpoint
CREATE TABLE `staff_message_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`message_id` text NOT NULL,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`from_assignee_user_id` text,
	`to_assignee_user_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `staff_message_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `staff_message_events_message_idx` ON `staff_message_events` (`message_id`, `created_at`);
