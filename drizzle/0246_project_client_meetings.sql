-- Google Meet calls with a project's clients. Each meeting lives on the
-- booking staff member's own Google Calendar (domain-wide delegation), so that
-- person hosts the call and receives its transcript and recording.
CREATE TABLE `project_client_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`organizer_user_id` text NOT NULL REFERENCES `users`(`id`),
	`organizer_email` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`time_zone` text NOT NULL,
	`guest_emails` text NOT NULL DEFAULT '[]',
	`staff_emails` text NOT NULL DEFAULT '[]',
	`google_event_id` text,
	`meeting_url` text,
	`status` text NOT NULL DEFAULT 'scheduled',
	`cancelled_by` text REFERENCES `users`(`id`),
	`cancelled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_client_meetings_project` ON `project_client_meetings` (`project_id`, `starts_at`);
--> statement-breakpoint
CREATE INDEX `idx_project_client_meetings_org` ON `project_client_meetings` (`organization_id`, `starts_at`);
