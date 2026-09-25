-- A number is a lookup candidate, never an automatic directory link.
-- The bridge stores the exact Sage read-back for an authorized reviewer.
ALTER TABLE `sage_contact_read_requests` ADD `purpose` text NOT NULL DEFAULT 'refresh';
--> statement-breakpoint
ALTER TABLE `sage_contact_read_requests` ADD `candidate_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `sage_contact_read_requests` ADD `reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `sage_contact_read_requests` ADD `reviewed_at` text;
--> statement-breakpoint
ALTER TABLE `sage_contact_read_requests` ADD `review_note` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_contact_link_active_entity_unique` ON `sage_contact_read_requests`
  (`organization_id`, `kind`, `entity_id`)
  WHERE `purpose` = 'link_candidate' AND `status` IN ('queued', 'running', 'awaiting_review');
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contacts_customer_sage_line_unique` ON `customer_contacts`
  (`customer_id`, `sage_line_number`) WHERE `sage_line_number` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_contacts_vendor_sage_line_unique` ON `vendor_contacts`
  (`vendor_id`, `sage_line_number`) WHERE `sage_line_number` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_contacts_org_sage_employee_number_unique` ON `internal_contacts`
  (`organization_id`, `sage_employee_number`)
  WHERE `sage_employee_number` IS NOT NULL AND trim(`sage_employee_number`) <> '';
--> statement-breakpoint
CREATE TABLE `sage_contact_link_events` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL REFERENCES `sage_contact_read_requests`(`id`) ON DELETE restrict,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `actor_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `event_type` text NOT NULL,
  `detail_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_contact_link_events_request_idx` ON `sage_contact_link_events` (`request_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `sage_contact_link_events_no_update` BEFORE UPDATE ON `sage_contact_link_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact link events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `sage_contact_link_events_no_delete` BEFORE DELETE ON `sage_contact_link_events`
BEGIN SELECT RAISE(ABORT, 'Sage contact link events are immutable'); END;
