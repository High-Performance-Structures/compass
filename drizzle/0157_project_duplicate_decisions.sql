CREATE TABLE `project_duplicate_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_a_id` text NOT NULL,
	`project_b_id` text NOT NULL,
	`status` text NOT NULL,
	`kept_project_id` text,
	`removed_project_id` text,
	`score` integer NOT NULL,
	`reasons_json` text NOT NULL,
	`removed_project_snapshot_json` text,
	`resolved_by_user_id` text,
	`resolved_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `project_duplicate_decisions_distinct_projects_check` CHECK (`project_a_id` < `project_b_id`),
	CONSTRAINT `project_duplicate_decisions_status_check` CHECK (`status` IN ('not_duplicate', 'merged')),
	CONSTRAINT `project_duplicate_decisions_merge_selection_check` CHECK ((`status` = 'not_duplicate' AND `kept_project_id` IS NULL AND `removed_project_id` IS NULL) OR (`status` = 'merged' AND `kept_project_id` IS NOT NULL AND `removed_project_id` IS NOT NULL AND `kept_project_id` <> `removed_project_id`)),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_duplicate_decisions_org_pair_unique` ON `project_duplicate_decisions` (`organization_id`,`project_a_id`,`project_b_id`);
--> statement-breakpoint
CREATE INDEX `project_duplicate_decisions_org_status_idx` ON `project_duplicate_decisions` (`organization_id`,`status`,`updated_at`);
