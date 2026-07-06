CREATE TABLE `project_vendor_bill_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`submitted_by` text,
	`project_contact_id` text,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_record_id` text,
	`vendor_name` text NOT NULL,
	`vendor_email` text,
	`bill_number` text,
	`bill_date` text,
	`due_date` text,
	`description` text,
	`total_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`review_status` text DEFAULT 'needs_review' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_notes` text,
	`converted_operation_id` text,
	`sage_write_status` text DEFAULT 'not_ready' NOT NULL,
	`sync_status` text DEFAULT 'compass_intake' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_contact_id`) REFERENCES `project_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`converted_operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submissions_project` ON `project_vendor_bill_submissions` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submissions_status` ON `project_vendor_bill_submissions` (`project_id`,`review_status`);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submissions_submitter` ON `project_vendor_bill_submissions` (`submitted_by`);
--> statement-breakpoint
CREATE TABLE `project_vendor_bill_submission_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`project_id` text NOT NULL,
	`line_number` integer DEFAULT 1 NOT NULL,
	`target_project_id` text,
	`phase_code` text,
	`cost_code` text,
	`description` text,
	`amount` real DEFAULT 0 NOT NULL,
	`review_status` text DEFAULT 'needs_coding' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `project_vendor_bill_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submission_lines_submission` ON `project_vendor_bill_submission_lines` (`submission_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submission_lines_project` ON `project_vendor_bill_submission_lines` (`project_id`);
--> statement-breakpoint
CREATE TABLE `project_vendor_bill_submission_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`project_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text,
	`file_size` integer DEFAULT 0 NOT NULL,
	`storage_provider` text DEFAULT 'google_drive' NOT NULL,
	`storage_id` text,
	`storage_url` text,
	`storage_status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `project_vendor_bill_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submission_attachments_submission` ON `project_vendor_bill_submission_attachments` (`submission_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_vendor_bill_submission_attachments_project` ON `project_vendor_bill_submission_attachments` (`project_id`);
