ALTER TABLE `customers` ADD `sage_client_id` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `sage_client_number` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `sage_client_status_id` integer;
--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_status_name` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_status_number` integer;
--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_type_name` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `sage_job_type_number` integer;
--> statement-breakpoint
CREATE TABLE `sage_write_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_write_approvals_org_user_idx` ON `sage_write_approvals` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `sage_client_project_write_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_id` text,
	`project_id` text,
	`requested_by_user_id` text,
	`operation_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`sage_client_id` text,
	`sage_client_number` text,
	`sage_job_id` text,
	`sage_job_number` text,
	`resolved_client_status_number` integer,
	`resolved_job_status_number` integer,
	`resolved_job_type_number` integer,
	`error_message` text,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_client_project_writes_idempotency_idx` ON `sage_client_project_write_operations` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `sage_client_project_writes_claim_idx` ON `sage_client_project_write_operations` (`status`,`claimed_at`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_client_project_writes_project_idx` ON `sage_client_project_write_operations` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `sage_client_project_writes_customer_idx` ON `sage_client_project_write_operations` (`customer_id`,`status`);
--> statement-breakpoint
INSERT INTO `sage_write_approvals` (`id`,`organization_id`,`user_id`,`approved_by_user_id`,`approved_at`,`created_at`,`updated_at`)
SELECT 'sage-write-' || `id`, 'org-1', `id`, NULL, '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'
FROM `users`
WHERE `id` IN (
	'user_01KWA65D4DSPYZFNP3G8WJPERK',
	'user_01KGSRW8957M25E2YJ1XTMS74Q',
	'user_01KW9VM5RTZED6W98FPMHGZQVE',
	'user_01KGNHZQAZ1A48TRTWGQFC1YMS',
	'user_01KGT1EQX4ZP94B7TVHMYMVZ0K',
	'user_01KWB4R4ZWZFNQHAWYX25KPSQB'
);
