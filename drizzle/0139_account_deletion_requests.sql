CREATE TABLE `account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email_snapshot` text,
	`display_name_snapshot` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` text NOT NULL,
	`processing_started_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `account_deletion_requests_user_status_idx` ON `account_deletion_requests` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `account_deletion_requests_status_requested_idx` ON `account_deletion_requests` (`status`,`requested_at`);
