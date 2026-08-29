-- Add fail-closed source participant identities and multi-assignee schedule responses.
CREATE TABLE `project_source_record_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_record_type` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_participant_id` text NOT NULL,
	`source_contact_id` text,
	`source_contact_name` text,
	`source_contact_email` text,
	`source_company` text,
	`participant_role` text NOT NULL,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`audience` text DEFAULT 'external' NOT NULL,
	`project_contact_id` text,
	`user_id` text,
	`identity_status` text DEFAULT 'unmatched' NOT NULL,
	`membership_status` text DEFAULT 'pending' NOT NULL,
	`review_status` text DEFAULT 'unreviewed' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_contact_id`) REFERENCES `project_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_source_record_participants_identity_unique` ON `project_source_record_participants` (`organization_id`,`project_id`,`source_record_type`,`source_record_id`,`source_participant_id`);
--> statement-breakpoint
CREATE INDEX `project_source_record_participants_record_idx` ON `project_source_record_participants` (`organization_id`,`project_id`,`source_record_type`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX `project_source_record_participants_project_contact_idx` ON `project_source_record_participants` (`project_contact_id`);
--> statement-breakpoint
CREATE INDEX `project_source_record_participants_user_idx` ON `project_source_record_participants` (`user_id`);
--> statement-breakpoint
CREATE INDEX `project_source_record_participants_review_idx` ON `project_source_record_participants` (`review_status`,`identity_status`,`membership_status`,`active`);
--> statement-breakpoint
CREATE TABLE `schedule_task_assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_task_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`participant_role` text DEFAULT 'assignee' NOT NULL,
	`source_start_date` text NOT NULL,
	`source_workdays` integer NOT NULL,
	`source_end_date` text NOT NULL,
	`response_status` text DEFAULT 'pending' NOT NULL,
	`date_response_status` text DEFAULT 'pending' NOT NULL,
	`duration_response_status` text DEFAULT 'pending' NOT NULL,
	`proposed_start_date` text,
	`proposed_workdays` integer,
	`proposed_end_date` text,
	`response_message` text,
	`responded_at` text,
	`responded_by_user_id` text,
	`response_source` text,
	`assigned_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`schedule_task_id`) REFERENCES `schedule_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `project_source_record_participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_task_assignees_task_participant_unique` ON `schedule_task_assignees` (`schedule_task_id`,`participant_id`);
--> statement-breakpoint
CREATE INDEX `schedule_task_assignees_participant_idx` ON `schedule_task_assignees` (`participant_id`);
