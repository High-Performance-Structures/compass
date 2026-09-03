CREATE TABLE `listening_rooms` (
  `id` text PRIMARY KEY NOT NULL,
  `channel_id` text NOT NULL,
  `host_user_id` text NOT NULL,
  `playback_state` text DEFAULT 'paused' NOT NULL,
  `current_track_id` text,
  `anchor_position_ms` integer DEFAULT 0 NOT NULL,
  `playback_started_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_rooms_channel_idx` ON `listening_rooms` (`channel_id`);
--> statement-breakpoint
CREATE INDEX `listening_rooms_host_idx` ON `listening_rooms` (`host_user_id`);
--> statement-breakpoint
CREATE TABLE `listening_queue_items` (
  `id` text PRIMARY KEY NOT NULL,
  `room_id` text NOT NULL,
  `title` text NOT NULL,
  `artist` text,
  `duration_ms` integer,
  `sort_order` integer NOT NULL,
  `added_by` text NOT NULL,
  `played_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`room_id`) REFERENCES `listening_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listening_queue_items_room_order_idx` ON `listening_queue_items` (`room_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `listening_queue_items_room_idx` ON `listening_queue_items` (`room_id`);
--> statement-breakpoint
CREATE TABLE `listening_track_links` (
  `id` text PRIMARY KEY NOT NULL,
  `queue_item_id` text NOT NULL,
  `provider` text NOT NULL,
  `url` text NOT NULL,
  `added_by` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`queue_item_id`) REFERENCES `listening_queue_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_track_links_item_provider_idx` ON `listening_track_links` (`queue_item_id`,`provider`);
--> statement-breakpoint
CREATE TABLE `listening_room_participants` (
  `id` text PRIMARY KEY NOT NULL,
  `room_id` text NOT NULL,
  `user_id` text NOT NULL,
  `preferred_provider` text,
  `joined_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`room_id`) REFERENCES `listening_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_room_participants_room_user_idx` ON `listening_room_participants` (`room_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `listening_room_participants_user_idx` ON `listening_room_participants` (`user_id`);
