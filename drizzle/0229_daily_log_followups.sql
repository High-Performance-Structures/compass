-- Daily logs tie into to-dos and client contact. Each to-do keeps a history
-- (created from a log, worked on in a log, still blocked, status changes);
-- a log's cost code line can name the to-do its hours were spent on; and a
-- client contact logged on a daily log remembers which log it came from.
CREATE TABLE `project_todo_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`todo_id` text NOT NULL,
	`kind` text NOT NULL,
	`daily_log_id` text,
	`from_status` text,
	`to_status` text,
	`note` text,
	`actor_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`todo_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`daily_log_id`) REFERENCES `daily_logs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_todo_events_todo_idx` ON `project_todo_events` (`todo_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_todo_events_project_idx` ON `project_todo_events` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_todo_events_daily_log_idx` ON `project_todo_events` (`daily_log_id`);
--> statement-breakpoint
ALTER TABLE `internal_duty_entries` ADD `todo_id` text REFERENCES project_operations(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `internal_duty_entries_todo_idx` ON `internal_duty_entries` (`todo_id`);
--> statement-breakpoint
ALTER TABLE `project_interactions` ADD `daily_log_id` text REFERENCES daily_logs(id) ON DELETE set null;
