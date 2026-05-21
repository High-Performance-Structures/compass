CREATE TABLE `notification_preferences` (
  `user_id` text PRIMARY KEY NOT NULL,
  `in_app_enabled` integer NOT NULL DEFAULT 1,
  `email_enabled` integer NOT NULL DEFAULT 1,
  `push_enabled` integer NOT NULL DEFAULT 1,
  `weekly_digest_enabled` integer NOT NULL DEFAULT 0,
  `rfi_enabled` integer NOT NULL DEFAULT 1,
  `owner_update_enabled` integer NOT NULL DEFAULT 1,
  `schedule_enabled` integer NOT NULL DEFAULT 1,
  `po_enabled` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `notification_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `event_type` text NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `href` text NOT NULL,
  `priority` text NOT NULL DEFAULT 'normal',
  `audience` text NOT NULL DEFAULT 'internal',
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `notification_recipients` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `user_id` text NOT NULL,
  `in_app` integer NOT NULL DEFAULT 1,
  `email` integer NOT NULL DEFAULT 0,
  `push` integer NOT NULL DEFAULT 0,
  `read_at` text,
  `dismissed_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`event_id`) REFERENCES `notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `notification_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `recipient_id` text NOT NULL,
  `user_id` text NOT NULL,
  `channel` text NOT NULL,
  `status` text NOT NULL DEFAULT 'queued',
  `to_address` text,
  `provider` text,
  `provider_message_id` text,
  `error` text,
  `attempted_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`event_id`) REFERENCES `notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`recipient_id`) REFERENCES `notification_recipients`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_notification_events_org_created` ON `notification_events` (`organization_id`, `created_at`);
CREATE INDEX `idx_notification_events_project` ON `notification_events` (`project_id`);
CREATE INDEX `idx_notification_recipients_user_created` ON `notification_recipients` (`user_id`, `created_at`);
CREATE INDEX `idx_notification_recipients_user_read` ON `notification_recipients` (`user_id`, `read_at`);
CREATE INDEX `idx_notification_deliveries_user_channel` ON `notification_deliveries` (`user_id`, `channel`);
