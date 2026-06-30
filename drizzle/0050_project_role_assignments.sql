CREATE TABLE `project_role_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role_id` text NOT NULL,
  `assignment_scope` text DEFAULT 'all' NOT NULL,
  `notes` text,
  `is_active` integer DEFAULT 1 NOT NULL,
  `assigned_by` text,
  `assigned_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `project_role_assignments_project_id_idx`
  ON `project_role_assignments` (`project_id`);

CREATE INDEX `project_role_assignments_user_id_idx`
  ON `project_role_assignments` (`user_id`);
