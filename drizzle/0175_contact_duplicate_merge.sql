ALTER TABLE `customers` ADD `merged_into_customer_id` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `merged_into_vendor_id` text;
--> statement-breakpoint
ALTER TABLE `customer_contacts` ADD `merged_into_person_id` text;
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `merged_into_person_id` text;
--> statement-breakpoint
CREATE TABLE `contact_merge_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `kind` text NOT NULL CHECK (`kind` IN ('customer_company', 'vendor_company', 'customer_person', 'vendor_person')),
  `source_id` text NOT NULL,
  `destination_id` text NOT NULL,
  `source_snapshot_json` text NOT NULL,
  `destination_snapshot_json` text NOT NULL,
  `moved_people_count` integer NOT NULL DEFAULT 0,
  `moved_project_contacts_count` integer NOT NULL DEFAULT 0,
  `merged_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `merged_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_merge_events_org_source_idx` ON `contact_merge_events` (`organization_id`, `kind`, `source_id`);
--> statement-breakpoint
CREATE INDEX `contact_merge_events_org_destination_idx` ON `contact_merge_events` (`organization_id`, `kind`, `destination_id`);
