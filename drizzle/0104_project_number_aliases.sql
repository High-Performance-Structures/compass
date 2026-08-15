CREATE TABLE `project_number_aliases` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `project_number` text NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_aliases_project_number_unique` ON `project_number_aliases` (`project_id`,`project_number`);--> statement-breakpoint
CREATE INDEX `project_number_aliases_org_number_idx` ON `project_number_aliases` (`organization_id`,`project_number`);
