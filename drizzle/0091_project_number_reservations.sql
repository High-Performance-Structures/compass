CREATE TABLE `project_number_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`department` text NOT NULL,
	`sequence` integer NOT NULL,
	`project_number` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_reservations_org_department_sequence_unique` ON `project_number_reservations` (`organization_id`,`department`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_reservations_org_number_unique` ON `project_number_reservations` (`organization_id`,`project_number`);
