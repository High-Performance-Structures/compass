CREATE TABLE `schedule_phase_options` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_phase_options_org_name_unique` ON `schedule_phase_options` (`organization_id`,`normalized_name`);
--> statement-breakpoint
CREATE INDEX `schedule_phase_options_org_name_idx` ON `schedule_phase_options` (`organization_id`,`name`);
