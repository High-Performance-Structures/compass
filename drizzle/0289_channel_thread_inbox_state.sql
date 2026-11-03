-- Inbox state for imported project conversations (channels) shown in the
-- project messages inbox, matching correspondence: Saved, Needs reply and
-- Archive are per person; Close is per conversation (staff only) and a newer
-- message reopens it. Additive only: one new table, one nullable column,
-- indexes. No data changes, no table rebuilds.
CREATE TABLE `channel_thread_user_state` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`saved_at` text,
	`needs_reply_at` text,
	`archived_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_thread_user_state_channel_user_unique` ON `channel_thread_user_state` (`channel_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `channel_thread_user_state_user_id_idx` ON `channel_thread_user_state` (`user_id`);
--> statement-breakpoint
CREATE INDEX `channel_thread_user_state_organization_id_idx` ON `channel_thread_user_state` (`organization_id`);
--> statement-breakpoint
-- When staff closed the conversation. A message created after it reopens it.
ALTER TABLE `channels` ADD COLUMN `thread_closed_at` text;
