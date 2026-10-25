-- Schedule warnings from the weather layer: one row per scheduled item,
-- weather rule and first day at risk, so each warning notifies only once.
CREATE TABLE `weather_schedule_risks` (
	`schedule_task_id` text NOT NULL REFERENCES `schedule_tasks`(`id`) ON DELETE cascade,
	`rule_id` text NOT NULL,
	`risk_date` text NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`detail` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`notified_at` text,
	PRIMARY KEY (`schedule_task_id`, `rule_id`, `risk_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_weather_schedule_risks_project` ON `weather_schedule_risks` (`project_id`, `risk_date`);
