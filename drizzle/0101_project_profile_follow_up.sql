ALTER TABLE `projects` ADD `mailing_address` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `client_status` text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `job_status_id` text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE `projects`
SET `job_status_id` = CASE UPPER(`status`)
  WHEN 'COMPLETE' THEN 'complete'
  WHEN 'CLOSED' THEN 'closed'
  WHEN 'BID REFUSED' THEN 'bid_refused'
  WHEN 'BID_REFUSED' THEN 'bid_refused'
  WHEN 'INACTIVE' THEN 'inactive'
  WHEN 'ARCHIVE' THEN 'inactive'
  ELSE 'current'
END;--> statement-breakpoint
CREATE TABLE `project_job_statuses` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `label` text NOT NULL,
  `sage_code` text,
  `follow_up_cadence_days` integer,
  `active` integer DEFAULT true NOT NULL,
  `sort_order` integer DEFAULT 1000 NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `project_job_statuses_org_label_unique` ON `project_job_statuses` (`organization_id`,`label`);--> statement-breakpoint
CREATE INDEX `project_job_statuses_org_active_idx` ON `project_job_statuses` (`organization_id`,`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `project_profile_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `actor_user_id` text,
  `event_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text,
  `before_json` text,
  `after_json` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `project_profile_audit_events_project_created_idx` ON `project_profile_audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_notes` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `content` text NOT NULL,
  `created_by` text,
  `updated_by` text,
  `deleted_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `project_notes_project_created_idx` ON `project_notes` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_interactions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `project_contact_id` text,
  `interaction_type` text NOT NULL,
  `direction` text NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `summary` text NOT NULL,
  `occurred_at` text NOT NULL,
  `created_by` text,
  `updated_by` text,
  `deleted_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_contact_id`) REFERENCES `project_contacts`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `project_interactions_project_occurred_idx` ON `project_interactions` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `project_interactions_org_occurred_idx` ON `project_interactions` (`organization_id`,`occurred_at`);
