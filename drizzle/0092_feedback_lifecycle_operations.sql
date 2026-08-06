ALTER TABLE `feedback_desk_items` ADD `assigned_to_user_id` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `assigned_to_name` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `sla_target_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `triaged_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `resolved_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `last_requester_update_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `last_github_sync_at` text;
--> statement-breakpoint
ALTER TABLE `feedback_desk_items` ADD `privacy_scrubbed_at` text;
--> statement-breakpoint
CREATE INDEX `feedback_desk_owner_sla_idx` ON `feedback_desk_items` (`organization_id`,`assigned_to_user_id`,`sla_target_at`);
--> statement-breakpoint
CREATE TABLE `feedback_service_health` (
	`service_name` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`status` text NOT NULL,
	`last_heartbeat_at` text NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`metadata` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_service_health_org_idx` ON `feedback_service_health` (`organization_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `feedback_maintenance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`operation` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `feedback_maintenance_runs_org_idx` ON `feedback_maintenance_runs` (`organization_id`,`started_at`);
