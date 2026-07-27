CREATE TABLE `organization_calendar_settings` (
  `organization_id` text PRIMARY KEY NOT NULL,
  `default_project_id` text,
  `time_zone` text NOT NULL DEFAULT 'America/Denver',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`default_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_calendar_settings` (
  `organization_id`,
  `default_project_id`,
  `time_zone`,
  `created_at`,
  `updated_at`
)
SELECT
  organization.`id`,
  NULL,
  'America/Denver',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `organizations` AS organization;
--> statement-breakpoint
CREATE TABLE `work_calendar_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `title` text NOT NULL,
  `description` text,
  `start_date` text,
  `end_date_exclusive` text,
  `starts_at` text,
  `ends_at` text,
  `all_day` integer NOT NULL DEFAULT 0,
  `time_zone` text NOT NULL DEFAULT 'UTC',
  `location` text,
  `status` text NOT NULL DEFAULT 'open',
  `version` integer NOT NULL DEFAULT 1,
  `created_by` text,
  `updated_by` text,
  `cancelled_by` text,
  `cancelled_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK (`status` IN ('open', 'cancelled')),
  CHECK (
    (
      `all_day` = 1
      AND `start_date` IS NOT NULL
      AND `end_date_exclusive` IS NOT NULL
      AND `starts_at` IS NULL
      AND `ends_at` IS NULL
      AND `start_date` < `end_date_exclusive`
    )
    OR
    (
      `all_day` = 0
      AND `start_date` IS NULL
      AND `end_date_exclusive` IS NULL
      AND `starts_at` IS NOT NULL
      AND `ends_at` IS NOT NULL
      AND `starts_at` < `ends_at`
    )
  )
);
--> statement-breakpoint
CREATE INDEX `idx_work_calendar_events_org_start`
  ON `work_calendar_events` (
    `organization_id`,
    `status`,
    `start_date`,
    `starts_at`
  );
--> statement-breakpoint
CREATE INDEX `idx_work_calendar_events_project_start`
  ON `work_calendar_events` (
    `project_id`,
    `status`,
    `start_date`,
    `starts_at`
  );
--> statement-breakpoint
CREATE TABLE `work_calendar_event_attendees` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `user_id` text NOT NULL,
  `response_status` text NOT NULL DEFAULT 'needs_action',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`event_id`) REFERENCES `work_calendar_events`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`response_status` IN ('needs_action', 'accepted', 'tentative', 'declined'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_calendar_event_attendee_unique`
  ON `work_calendar_event_attendees` (`event_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `idx_work_calendar_event_attendees_user`
  ON `work_calendar_event_attendees` (`user_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `work_calendar_events` (
  `id`,
  `organization_id`,
  `project_id`,
  `title`,
  `description`,
  `start_date`,
  `end_date_exclusive`,
  `starts_at`,
  `ends_at`,
  `all_day`,
  `time_zone`,
  `location`,
  `status`,
  `version`,
  `created_by`,
  `updated_by`,
  `cancelled_by`,
  `cancelled_at`,
  `created_at`,
  `updated_at`
)
SELECT
  operation.`id`,
  project.`organization_id`,
  operation.`project_id`,
  operation.`title`,
  operation.`description`,
  COALESCE(operation.`start_date`, operation.`due_date`),
  date(COALESCE(operation.`due_date`, operation.`start_date`), '+1 day'),
  NULL,
  NULL,
  1,
  'UTC',
  NULL,
  CASE
    WHEN lower(operation.`status`) = 'cancelled' THEN 'cancelled'
    ELSE 'open'
  END,
  1,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN lower(operation.`status`) = 'cancelled' THEN operation.`updated_at`
    ELSE NULL
  END,
  operation.`created_at`,
  operation.`updated_at`
FROM `project_operations` AS operation
INNER JOIN `projects` AS project
  ON project.`id` = operation.`project_id`
WHERE operation.`source_record_type` = 'calendar_event'
  AND COALESCE(operation.`start_date`, operation.`due_date`) IS NOT NULL
  AND COALESCE(operation.`due_date`, operation.`start_date`) IS NOT NULL;
