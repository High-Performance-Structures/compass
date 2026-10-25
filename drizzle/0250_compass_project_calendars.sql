CREATE TABLE `compass_project_calendars` (
  `project_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `enabled` integer,
  `owner_email` text,
  `google_calendar_id` text,
  `calendar_name` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `last_synced_at` text,
  `last_error` text,
  `updated_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `compass_project_calendars_org` ON `compass_project_calendars` (`organization_id`, `last_synced_at`);

CREATE TABLE `compass_project_calendar_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `item_key` text NOT NULL,
  `google_event_id` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `compass_project_calendar_events_key` ON `compass_project_calendar_events` (`project_id`, `item_key`);

CREATE TABLE `compass_project_calendar_members` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `email` text NOT NULL,
  `acl_rule_id` text NOT NULL,
  `listed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `compass_project_calendar_members_user` ON `compass_project_calendar_members` (`project_id`, `user_id`);
