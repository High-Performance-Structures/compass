CREATE TABLE `schedule_task_links` (
  `id` text PRIMARY KEY NOT NULL,
  `schedule_task_id` text NOT NULL,
  `project_id` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text,
  `label` text NOT NULL,
  `href` text NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`schedule_task_id`) REFERENCES `schedule_tasks`(`id`) ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_task_links_task`
  ON `schedule_task_links` (`schedule_task_id`);
--> statement-breakpoint
CREATE INDEX `idx_schedule_task_links_project_type`
  ON `schedule_task_links` (`project_id`, `resource_type`);
