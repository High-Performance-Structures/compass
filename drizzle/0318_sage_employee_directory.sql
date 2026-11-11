-- Read-only copy of Sage's employee list (dbo.employ), replaced whole by the
-- read-only Sage employee reader. Compass links staff to their Sage employee
-- by email (one-to-one only) and follows each linked employee's status.
-- Additive only: a new table, no existing rows change.
CREATE TABLE `sage_employee_directory_entries` (
	`organization_id` text NOT NULL,
	`sage_record_id` text NOT NULL,
	`sage_employee_number` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text,
	`sage_status_code` integer,
	`inactive` integer DEFAULT false NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_employee_directory_org_id_unique` ON `sage_employee_directory_entries` (`organization_id`,`sage_record_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_employee_directory_org_number_unique` ON `sage_employee_directory_entries` (`organization_id`,`sage_employee_number`);
--> statement-breakpoint
CREATE INDEX `sage_employee_directory_org_email_idx` ON `sage_employee_directory_entries` (`organization_id`,`email`);
