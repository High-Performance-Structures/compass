ALTER TABLE `google_calendar_connections`
  ADD `is_organization_calendar_owner` integer DEFAULT false NOT NULL;

CREATE UNIQUE INDEX `google_calendar_connection_org_owner_unique`
  ON `google_calendar_connections` (`organization_id`)
  WHERE `is_organization_calendar_owner` = 1;

CREATE TABLE `google_project_calendars` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `owner_connection_id` text NOT NULL,
  `selection_id` text NOT NULL,
  `google_calendar_id` text NOT NULL,
  `summary` text NOT NULL,
  `time_zone` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `last_acl_synced_at` text,
  `last_synced_at` text,
  `last_error` text,
  `created_by` text,
  `updated_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`owner_connection_id`) REFERENCES `google_calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`selection_id`) REFERENCES `google_calendar_selections`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `google_project_calendar_project_unique`
  ON `google_project_calendars` (`project_id`);
CREATE UNIQUE INDEX `google_project_calendar_google_unique`
  ON `google_project_calendars` (`owner_connection_id`, `google_calendar_id`);
CREATE INDEX `idx_google_project_calendars_org_status`
  ON `google_project_calendars` (`organization_id`, `status`);

CREATE TABLE `google_project_calendar_acl_members` (
  `id` text PRIMARY KEY NOT NULL,
  `project_calendar_id` text NOT NULL,
  `user_id` text,
  `email` text NOT NULL,
  `google_acl_rule_id` text NOT NULL,
  `role` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_calendar_id`) REFERENCES `google_project_calendars`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `google_project_calendar_acl_email_unique`
  ON `google_project_calendar_acl_members` (`project_calendar_id`, `email`);
CREATE INDEX `idx_google_project_calendar_acl_user`
  ON `google_project_calendar_acl_members` (`user_id`);

CREATE TABLE `google_project_calendar_subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_calendar_id` text NOT NULL,
  `user_id` text NOT NULL,
  `connection_id` text NOT NULL,
  `subscribed_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_calendar_id`) REFERENCES `google_project_calendars`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`connection_id`) REFERENCES `google_calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `google_project_calendar_subscription_unique`
  ON `google_project_calendar_subscriptions` (`project_calendar_id`, `user_id`);
