ALTER TABLE `google_calendar_selections`
  ADD COLUMN `calendar_scope` text NOT NULL DEFAULT 'personal'
  CHECK (`calendar_scope` IN ('personal', 'organization'));
--> statement-breakpoint
ALTER TABLE `google_calendar_selections`
  ADD COLUMN `internal_visibility` text NOT NULL DEFAULT 'busy'
  CHECK (`internal_visibility` IN ('busy', 'details'));
--> statement-breakpoint
ALTER TABLE `google_calendar_selections`
  ADD COLUMN `internal_can_create` integer NOT NULL DEFAULT 0
  CHECK (`internal_can_create` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `google_calendar_selections`
  ADD COLUMN `internal_can_edit` integer NOT NULL DEFAULT 0
  CHECK (`internal_can_edit` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `google_calendar_selections`
  ADD COLUMN `internal_can_delete` integer NOT NULL DEFAULT 0
  CHECK (`internal_can_delete` IN (0, 1));
--> statement-breakpoint
CREATE TABLE `google_calendar_events` (
  `id` text PRIMARY KEY NOT NULL,
  `selection_id` text NOT NULL,
  `google_event_id` text NOT NULL,
  `google_ical_uid` text,
  `recurring_event_id` text,
  `status` text NOT NULL DEFAULT 'confirmed',
  `title` text NOT NULL,
  `description` text,
  `location` text,
  `html_link` text,
  `meeting_url` text,
  `start_date` text,
  `end_date_exclusive` text,
  `starts_at` text,
  `ends_at` text,
  `all_day` integer NOT NULL DEFAULT 0,
  `time_zone` text,
  `visibility` text NOT NULL DEFAULT 'default',
  `transparency` text NOT NULL DEFAULT 'opaque',
  `organizer_email` text,
  `google_etag` text,
  `google_updated_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`selection_id`) REFERENCES `google_calendar_selections`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`all_day` IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_calendar_event_unique`
  ON `google_calendar_events` (`selection_id`, `google_event_id`);
--> statement-breakpoint
CREATE INDEX `idx_google_calendar_events_start`
  ON `google_calendar_events` (`selection_id`, `status`, `start_date`, `starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_google_calendar_events_ical_uid`
  ON `google_calendar_events` (`google_ical_uid`);
