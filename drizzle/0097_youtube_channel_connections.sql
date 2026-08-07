CREATE TABLE `youtube_channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_title` text NOT NULL,
	`google_account_email` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`granted_scopes` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`connected_by` text,
	`connected_at` text NOT NULL,
	`last_upload_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_channel_connections_org_key_unique` ON `youtube_channel_connections` (`organization_id`,`channel_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_channel_connections_org_channel_unique` ON `youtube_channel_connections` (`organization_id`,`channel_id`);
--> statement-breakpoint
CREATE INDEX `youtube_channel_connections_org_status_idx` ON `youtube_channel_connections` (`organization_id`,`status`);
