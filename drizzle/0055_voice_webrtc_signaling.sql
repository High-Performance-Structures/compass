CREATE TABLE `voice_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text,
	`is_muted` integer DEFAULT false NOT NULL,
	`is_deafened` integer DEFAULT false NOT NULL,
	`joined_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `voice_participants_channel_idx` ON `voice_participants` (`channel_id`);
--> statement-breakpoint
CREATE INDEX `voice_participants_user_idx` ON `voice_participants` (`user_id`);
--> statement-breakpoint
CREATE INDEX `voice_participants_seen_idx` ON `voice_participants` (`channel_id`, `last_seen_at`);
--> statement-breakpoint
CREATE TABLE `voice_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`sender_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `voice_signals_target_idx` ON `voice_signals` (`channel_id`, `target_user_id`);
--> statement-breakpoint
CREATE INDEX `voice_signals_created_idx` ON `voice_signals` (`channel_id`, `created_at`);
