CREATE TABLE IF NOT EXISTS `staff_board_posts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `author_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE restrict,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `is_pinned` integer NOT NULL DEFAULT 0,
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_board_posts_org_created_idx`
  ON `staff_board_posts` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `staff_board_posts_org_pinned_idx`
  ON `staff_board_posts` (`organization_id`, `is_pinned`, `created_at`);
