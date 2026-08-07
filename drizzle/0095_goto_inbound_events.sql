CREATE TABLE `goto_inbound_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`message_id` text NOT NULL,
	`account_key` text NOT NULL,
	`owner_touchpoint` text NOT NULL,
	`sender_phone` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goto_inbound_events_message_unique` ON `goto_inbound_events` (`message_id`);
--> statement-breakpoint
CREATE INDEX `goto_inbound_events_org_status_idx` ON `goto_inbound_events` (`organization_id`,`status`,`received_at`);
--> statement-breakpoint
CREATE TABLE `goto_inbound_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_nickname` text NOT NULL,
	`subscription_id` text,
	`configured_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configured_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goto_inbound_settings_org_unique` ON `goto_inbound_settings` (`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `goto_inbound_settings_account_unique` ON `goto_inbound_settings` (`account_key`);
