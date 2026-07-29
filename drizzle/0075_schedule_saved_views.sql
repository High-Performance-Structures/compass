CREATE TABLE `schedule_saved_views` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `name` text NOT NULL,
  `visibility` text DEFAULT 'personal' NOT NULL,
  `definition` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `schedule_saved_views_org_idx`
ON `schedule_saved_views` (`organization_id`);

CREATE INDEX `schedule_saved_views_owner_idx`
ON `schedule_saved_views` (`owner_user_id`);

CREATE UNIQUE INDEX `schedule_saved_views_owner_name_unique`
ON `schedule_saved_views` (`owner_user_id`, `name`);
