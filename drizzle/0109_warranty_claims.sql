CREATE TABLE `project_warranty_claims` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_record_id` text,
  `claim_number` text NOT NULL,
  `title` text NOT NULL,
  `location` text,
  `category` text NOT NULL,
  `description` text NOT NULL,
  `priority` text DEFAULT 'normal' NOT NULL,
  `status` text DEFAULT 'submitted' NOT NULL,
  `audience` text DEFAULT 'owner' NOT NULL,
  `promotion_state` text DEFAULT 'actionable' NOT NULL,
  `claimant_user_id` text,
  `claimant_name` text NOT NULL,
  `assigned_user_id` text,
  `assigned_name` text,
  `acknowledged_at` text,
  `scheduled_for` text,
  `work_started_at` text,
  `resolved_at` text,
  `owner_confirmed_at` text,
  `resolution_summary` text,
  `internal_notes` text,
  `created_by` text,
  `submitted_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`claimant_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK (`priority` IN ('low', 'normal', 'high', 'urgent')),
  CHECK (`status` IN ('submitted', 'acknowledged', 'visit_scheduled', 'in_progress', 'waiting_on_owner', 'resolved', 'closed', 'rejected')),
  CHECK (`audience` IN ('internal', 'owner')),
  CHECK (`promotion_state` IN ('actionable', 'review_required', 'archive_only', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_warranty_claims_project_number_uq` ON `project_warranty_claims` (`project_id`,`claim_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_warranty_claims_source_uq` ON `project_warranty_claims` (`organization_id`,`source_system`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX `project_warranty_claims_project_status_idx` ON `project_warranty_claims` (`project_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `project_warranty_claims_assignee_idx` ON `project_warranty_claims` (`project_id`,`assigned_user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `project_warranty_claim_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `claim_id` text NOT NULL,
  `file_name` text NOT NULL,
  `mime_type` text,
  `file_size` integer DEFAULT 0 NOT NULL,
  `storage_provider` text DEFAULT 'google_drive' NOT NULL,
  `storage_id` text,
  `storage_url` text,
  `owner_visible` integer DEFAULT true NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`claim_id`) REFERENCES `project_warranty_claims`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_warranty_claim_attachments_claim_idx` ON `project_warranty_claim_attachments` (`claim_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_warranty_claim_attachments_project_idx` ON `project_warranty_claim_attachments` (`project_id`);
--> statement-breakpoint
CREATE TABLE `project_warranty_claim_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `claim_id` text NOT NULL,
  `actor_user_id` text,
  `actor_name` text NOT NULL,
  `actor_role` text NOT NULL,
  `event_type` text NOT NULL,
  `from_status` text,
  `to_status` text,
  `note` text,
  `owner_visible` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`claim_id`) REFERENCES `project_warranty_claims`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_warranty_claim_events_claim_idx` ON `project_warranty_claim_events` (`claim_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `buildertrend_warranty_claim_staging` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `source_record_id` text NOT NULL,
  `source_project_id` text,
  `source_claim_number` text,
  `title` text NOT NULL,
  `description` text,
  `source_status` text,
  `source_priority` text,
  `source_created_at` text,
  `source_updated_at` text,
  `source_url` text,
  `raw_payload_json` text NOT NULL,
  `review_status` text DEFAULT 'needs_review' NOT NULL,
  `review_notes` text,
  `promoted_claim_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`promoted_claim_id`) REFERENCES `project_warranty_claims`(`id`) ON UPDATE no action ON DELETE set null,
  CHECK (`review_status` IN ('needs_review', 'approved', 'archive_only', 'rejected', 'promoted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_warranty_staging_source_uq` ON `buildertrend_warranty_claim_staging` (`organization_id`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_warranty_staging_review_idx` ON `buildertrend_warranty_claim_staging` (`organization_id`,`review_status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `buildertrend_warranty_staging_project_idx` ON `buildertrend_warranty_claim_staging` (`project_id`);
