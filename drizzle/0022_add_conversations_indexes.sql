CREATE INDEX `idx_messages_channel_created` ON `messages`(`channel_id`,`created_at` DESC);
--> statement-breakpoint
CREATE INDEX `idx_messages_thread` ON `messages`(`thread_id`);
--> statement-breakpoint
CREATE INDEX `idx_messages_channel_pinned` ON `messages`(`channel_id`,`is_pinned`) WHERE `is_pinned` = 1;
--> statement-breakpoint
CREATE INDEX `idx_channel_members_lookup` ON `channel_members`(`channel_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_typing_sessions_channel_expires` ON `typing_sessions`(`channel_id`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_user_presence_user` ON `user_presence`(`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_channel_read_state_lookup` ON `channel_read_state`(`channel_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_message_reactions_message` ON `message_reactions`(`message_id`);
--> statement-breakpoint
CREATE INDEX `idx_channel_categories_org` ON `channel_categories`(`organization_id`);
