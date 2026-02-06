CREATE TABLE `plugin_config` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_encrypted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`event_type` text NOT NULL,
	`details` text,
	`user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`version` text NOT NULL,
	`source` text NOT NULL,
	`source_type` text NOT NULL,
	`capabilities` text NOT NULL,
	`required_env_vars` text,
	`status` text DEFAULT 'disabled' NOT NULL,
	`status_reason` text,
	`enabled_by` text,
	`enabled_at` text,
	`installed_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`enabled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
