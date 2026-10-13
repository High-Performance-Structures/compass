-- Linked jobs: a job created for the same customer and site in another
-- department (pour help on a Nu-Tech job becomes an HPS job, an HPS shell
-- becomes an Open Range build, ...). Both jobs show the link.
CREATE TABLE `project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`linked_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`label` text,
	`created_by` text REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_links_pair_uq` ON `project_links` (`project_id`, `linked_project_id`);
--> statement-breakpoint
CREATE INDEX `project_links_linked_idx` ON `project_links` (`linked_project_id`);
