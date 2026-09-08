CREATE TABLE `project_number_review_decisions` (`id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL, `project_number` text NOT NULL, `status` text NOT NULL, `resolved_by_user_id` text, `resolved_at` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL, CONSTRAINT `project_number_review_decisions_status_check` CHECK (`status` = 'approved_exception'), FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade, FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade, FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_review_decisions_org_project_number_unique` ON `project_number_review_decisions` (`organization_id`,`project_id`,`project_number`);
--> statement-breakpoint
CREATE INDEX `project_number_review_decisions_org_status_idx` ON `project_number_review_decisions` (`organization_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `project_registry_removals` (`id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `project_id` text NOT NULL, `original_project_number` text, `original_status` text NOT NULL, `project_snapshot_json` text NOT NULL, `removed_by_user_id` text, `removed_at` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL, FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade, FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade, FOREIGN KEY (`removed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_registry_removals_org_project_unique` ON `project_registry_removals` (`organization_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `project_registry_removals_org_removed_idx` ON `project_registry_removals` (`organization_id`,`removed_at`);
--> statement-breakpoint
CREATE TABLE `project_number_retirements` (`id` text PRIMARY KEY NOT NULL, `organization_id` text NOT NULL, `former_project_id` text NOT NULL, `project_number` text NOT NULL, `department` text, `sequence` integer, `retired_by_user_id` text, `retired_at` text NOT NULL, FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade, FOREIGN KEY (`retired_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_retirements_org_number_unique` ON `project_number_retirements` (`organization_id`,`project_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_retirements_org_department_sequence_unique` ON `project_number_retirements` (`organization_id`,`department`,`sequence`);
