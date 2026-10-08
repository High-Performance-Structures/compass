-- New Sage child contacts are reviewed separately from updates to existing IDs.
-- An attempted Add is never automatically retried: a lost response requires
-- explicit reconciliation to avoid creating a duplicate person in Sage.
CREATE TABLE `sage_contact_create_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `kind` text NOT NULL CHECK (`kind` IN ('client_person', 'vendor_person')),
  `customer_id` text REFERENCES `customers`(`id`) ON DELETE restrict,
  `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE restrict,
  `parent_sage_record_id` text NOT NULL,
  `fields_json` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `requested_by_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE restrict,
  `reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `reviewed_at` text,
  `review_note` text,
  `claim_token` text,
  `claimed_at` text,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `sage_contact_id` text,
  `sage_line_number` integer,
  `error_message` text,
  `requested_at` text NOT NULL,
  `completed_at` text,
  `updated_at` text NOT NULL,
  CHECK ((`kind` = 'client_person' AND `customer_id` IS NOT NULL AND `vendor_id` IS NULL)
    OR (`kind` = 'vendor_person' AND `vendor_id` IS NOT NULL AND `customer_id` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_contact_create_active_dedupe_unique` ON `sage_contact_create_proposals`
  (`organization_id`, `dedupe_key`)
  WHERE `status` IN ('pending', 'approved', 'running', 'needs_reconciliation');
--> statement-breakpoint
CREATE INDEX `sage_contact_create_claim_idx` ON `sage_contact_create_proposals`
  (`status`, `claimed_at`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_contact_create_company_idx` ON `sage_contact_create_proposals`
  (`organization_id`, `kind`, `customer_id`, `vendor_id`, `status`);
--> statement-breakpoint
CREATE TABLE `sage_contact_create_events` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL REFERENCES `sage_contact_create_proposals`(`id`) ON DELETE restrict,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `actor_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `event_type` text NOT NULL,
  `detail_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_contact_create_events_proposal_idx` ON `sage_contact_create_events`
  (`proposal_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `sage_contact_create_immutable_plan` BEFORE UPDATE OF
  `organization_id`, `kind`, `customer_id`, `vendor_id`, `parent_sage_record_id`,
  `fields_json`, `dedupe_key`, `requested_by_user_id`, `requested_at`
  ON `sage_contact_create_proposals`
BEGIN SELECT RAISE(ABORT, 'Sage contact create plan is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_create_no_delete` BEFORE DELETE ON `sage_contact_create_proposals`
BEGIN SELECT RAISE(ABORT, 'Sage contact create proposals are immutable audit records'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_create_events_no_update` BEFORE UPDATE ON `sage_contact_create_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact create events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_create_events_no_delete` BEFORE DELETE ON `sage_contact_create_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact create events are immutable'); END;
