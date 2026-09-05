ALTER TABLE `sage_square_payment_operations` ADD `organization_id` text REFERENCES `organizations`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `sage_square_payment_operations` ADD `project_id` text REFERENCES `projects`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `sage_square_payment_operations` ADD `sage_job_short_name` text;
--> statement-breakpoint
CREATE INDEX `sage_square_payment_operations_org_project_idx` ON `sage_square_payment_operations` (`organization_id`,`project_id`,`payment_completed_at`);
