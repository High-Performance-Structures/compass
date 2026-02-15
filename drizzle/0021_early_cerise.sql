CREATE TABLE `channel_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed_by_default` integer DEFAULT false,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `typing_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_presence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`status_message` text,
	`last_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`thread_id` text,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`content_html` text,
	`edited_at` text,
	`deleted_at` text,
	`deleted_by` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`last_reply_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "channel_id", "thread_id", "user_id", "content", "content_html", "edited_at", "deleted_at", "deleted_by", "is_pinned", "reply_count", "last_reply_at", "created_at") SELECT "id", "channel_id", "thread_id", "user_id", "content", "content_html", "edited_at", "deleted_at", "deleted_by", "is_pinned", "reply_count", "last_reply_at", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `channels` ADD `category_id` text REFERENCES channel_categories(id);