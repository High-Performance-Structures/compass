-- Department job workflows: items someone ticked on a job's overview
-- checklist. Unticking deletes the row; items Compass already records
-- (an estimate sent, a contract signed) never need one.
CREATE TABLE `project_workflow_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`item_key` text NOT NULL,
	`checked_by` text,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_workflow_checks_project_item_unique` ON `project_workflow_checks` (`project_id`, `item_key`);
--> statement-breakpoint
CREATE INDEX `project_workflow_checks_org_idx` ON `project_workflow_checks` (`organization_id`);
