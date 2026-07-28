ALTER TABLE `work_calendar_events`
  ADD COLUMN `event_type` text NOT NULL DEFAULT 'meeting'
  CHECK (`event_type` IN (
    'meeting',
    'appointment',
    'inspection',
    'delivery',
    'company_event',
    'absence',
    'other'
  ));
--> statement-breakpoint
ALTER TABLE `work_calendar_events`
  ADD COLUMN `visibility` text NOT NULL DEFAULT 'organization'
  CHECK (`visibility` IN ('organization', 'participants', 'busy', 'private'));
--> statement-breakpoint
ALTER TABLE `work_calendar_events`
  ADD COLUMN `meeting_url` text;
--> statement-breakpoint
CREATE TABLE `google_calendar_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `user_id` text NOT NULL,
  `google_account_id` text NOT NULL,
  `google_account_email` text NOT NULL,
  `refresh_token_encrypted` text NOT NULL,
  `granted_scopes` text NOT NULL,
  `status` text NOT NULL DEFAULT 'connected',
  `calendar_sync_enabled` integer NOT NULL DEFAULT 0,
  `tasks_sync_enabled` integer NOT NULL DEFAULT 0,
  `connected_at` text NOT NULL,
  `last_synced_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`status` IN ('connected', 'reauthorization_required', 'paused', 'error')),
  CHECK (`calendar_sync_enabled` IN (0, 1)),
  CHECK (`tasks_sync_enabled` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_connection_user_unique`
  ON `google_calendar_connections` (`organization_id`, `user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_connection_account_unique`
  ON `google_calendar_connections` (`organization_id`, `google_account_id`);
--> statement-breakpoint
CREATE INDEX `idx_google_calendar_connections_status`
  ON `google_calendar_connections` (`organization_id`, `status`);
--> statement-breakpoint
CREATE TABLE `google_calendar_selections` (
  `id` text PRIMARY KEY NOT NULL,
  `connection_id` text NOT NULL,
  `google_calendar_id` text NOT NULL,
  `summary` text NOT NULL,
  `description` text,
  `time_zone` text,
  `background_color` text,
  `access_role` text NOT NULL DEFAULT 'reader',
  `is_primary` integer NOT NULL DEFAULT 0,
  `selected` integer NOT NULL DEFAULT 0,
  `import_events` integer NOT NULL DEFAULT 0,
  `export_compass_events` integer NOT NULL DEFAULT 0,
  `is_compass_destination` integer NOT NULL DEFAULT 0,
  `sync_token` text,
  `watch_channel_id` text,
  `watch_resource_id` text,
  `watch_expires_at` text,
  `last_synced_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `google_calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`access_role` IN ('freeBusyReader', 'reader', 'writer', 'owner')),
  CHECK (`selected` IN (0, 1)),
  CHECK (`import_events` IN (0, 1)),
  CHECK (`export_compass_events` IN (0, 1)),
  CHECK (`is_compass_destination` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_selection_unique`
  ON `google_calendar_selections` (`connection_id`, `google_calendar_id`);
--> statement-breakpoint
CREATE INDEX `idx_google_calendar_selections_selected`
  ON `google_calendar_selections` (`connection_id`, `selected`);
--> statement-breakpoint
CREATE TABLE `google_calendar_entity_links` (
  `id` text PRIMARY KEY NOT NULL,
  `connection_id` text NOT NULL,
  `google_calendar_id` text NOT NULL,
  `google_event_id` text NOT NULL,
  `google_ical_uid` text,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `sync_direction` text NOT NULL DEFAULT 'push',
  `sync_status` text NOT NULL DEFAULT 'pending',
  `google_etag` text,
  `google_updated_at` text,
  `compass_version` integer,
  `last_synced_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`connection_id`) REFERENCES `google_calendar_connections`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`source_type` IN ('work_calendar_event', 'schedule_item', 'task')),
  CHECK (`sync_direction` IN ('push', 'pull', 'two_way')),
  CHECK (`sync_status` IN ('pending', 'synced', 'conflict', 'error', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_entity_source_unique`
  ON `google_calendar_entity_links` (
    `connection_id`,
    `google_calendar_id`,
    `source_type`,
    `source_id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_entity_event_unique`
  ON `google_calendar_entity_links` (
    `connection_id`,
    `google_calendar_id`,
    `google_event_id`
  );
--> statement-breakpoint
CREATE INDEX `idx_google_calendar_entity_sync_status`
  ON `google_calendar_entity_links` (`connection_id`, `sync_status`);
