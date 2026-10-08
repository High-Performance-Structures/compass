-- Contact edits remain proposals until an approved Sage write is read back.
CREATE TABLE `sage_contact_read_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `sage_record_id` text,
  `sage_record_number` text,
  `parent_sage_record_id` text,
  `status` text NOT NULL DEFAULT 'queued',
  `claim_token` text,
  `claimed_at` text,
  `requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `error_message` text,
  `requested_at` text NOT NULL,
  `completed_at` text
);
--> statement-breakpoint
CREATE INDEX `sage_contact_reads_claim_idx` ON `sage_contact_read_requests` (`status`, `claimed_at`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_contact_reads_entity_idx` ON `sage_contact_read_requests` (`organization_id`, `kind`, `entity_id`);
--> statement-breakpoint
CREATE TABLE `sage_contact_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `sage_record_id` text NOT NULL,
  `parent_sage_record_id` text,
  `revision` text NOT NULL,
  `fields_json` text NOT NULL,
  `captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_contact_snapshots_entity_unique` ON `sage_contact_snapshots` (`organization_id`, `kind`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `sage_contact_snapshots_sage_idx` ON `sage_contact_snapshots` (`organization_id`, `kind`, `sage_record_id`);
--> statement-breakpoint
CREATE TABLE `sage_contact_change_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `sage_record_id` text NOT NULL,
  `parent_sage_record_id` text,
  `base_revision` text NOT NULL,
  `changes_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `requested_by_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE restrict,
  `reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `reviewed_at` text,
  `review_note` text,
  `claim_token` text,
  `claimed_at` text,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `result_revision` text,
  `error_message` text,
  `requested_at` text NOT NULL,
  `completed_at` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_contact_changes_active_entity_unique` ON `sage_contact_change_proposals` (`organization_id`, `kind`, `entity_id`) WHERE `status` IN ('pending', 'approved', 'running');
--> statement-breakpoint
CREATE INDEX `sage_contact_changes_review_idx` ON `sage_contact_change_proposals` (`organization_id`, `status`, `requested_at`);
--> statement-breakpoint
CREATE TABLE `sage_contact_change_events` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL REFERENCES `sage_contact_change_proposals`(`id`) ON DELETE restrict,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `actor_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `event_type` text NOT NULL,
  `detail_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_contact_change_events_proposal_idx` ON `sage_contact_change_events` (`proposal_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `sage_contact_changes_immutable_plan` BEFORE UPDATE OF `organization_id`, `kind`, `entity_id`, `sage_record_id`, `parent_sage_record_id`, `base_revision`, `changes_json`, `requested_by_user_id`, `requested_at` ON `sage_contact_change_proposals`
BEGIN SELECT RAISE(ABORT, 'Sage contact proposal identity and diff are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_changes_no_delete` BEFORE DELETE ON `sage_contact_change_proposals`
BEGIN SELECT RAISE(ABORT, 'Sage contact proposals are immutable audit records'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_change_events_no_update` BEFORE UPDATE ON `sage_contact_change_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact audit events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_change_events_no_delete` BEFORE DELETE ON `sage_contact_change_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact audit events are immutable'); END;
