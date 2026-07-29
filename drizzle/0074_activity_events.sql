CREATE TABLE `activity_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `actor_user_id` text,
  `actor_name` text NOT NULL,
  `actor_role` text NOT NULL,
  `category` text NOT NULL,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text,
  `summary` text NOT NULL,
  `metadata` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `activity_events_org_created_idx`
ON `activity_events` (`organization_id`, `created_at`);

CREATE INDEX `activity_events_project_created_idx`
ON `activity_events` (`project_id`, `created_at`);

CREATE INDEX `activity_events_actor_created_idx`
ON `activity_events` (`actor_user_id`, `created_at`);
