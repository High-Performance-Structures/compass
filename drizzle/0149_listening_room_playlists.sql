CREATE TABLE `listening_playlists` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `created_by` text NOT NULL,
  `updated_by` text NOT NULL,
  `deleted_at` text,
  `deleted_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `listening_playlists_org_active_idx` ON `listening_playlists` (`organization_id`,`deleted_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `listening_playlists_creator_idx` ON `listening_playlists` (`created_by`);
--> statement-breakpoint
CREATE TABLE `listening_playlist_items` (
  `id` text PRIMARY KEY NOT NULL,
  `playlist_id` text NOT NULL,
  `title` text NOT NULL,
  `artist` text,
  `duration_ms` integer,
  `sort_order` integer NOT NULL,
  `added_by` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`playlist_id`) REFERENCES `listening_playlists`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listening_playlist_items_playlist_order_idx` ON `listening_playlist_items` (`playlist_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `listening_playlist_track_links` (
  `id` text PRIMARY KEY NOT NULL,
  `playlist_item_id` text NOT NULL,
  `provider` text NOT NULL,
  `url` text NOT NULL,
  `added_by` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`playlist_item_id`) REFERENCES `listening_playlist_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_playlist_track_links_item_provider_idx` ON `listening_playlist_track_links` (`playlist_item_id`,`provider`);
