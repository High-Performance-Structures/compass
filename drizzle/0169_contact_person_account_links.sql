-- Account ownership is explicit. Never infer a person-to-login link by name
-- or email, and never grant an account access to another organization's data.
ALTER TABLE `customer_contacts` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contacts_company_user_unique` ON `customer_contacts` (`customer_id`, `user_id`) WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_contacts_company_user_unique` ON `vendor_contacts` (`vendor_id`, `user_id`) WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `customer_contacts_account_scope_insert` BEFORE INSERT ON `customer_contacts`
WHEN NEW.`user_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customers` c
  JOIN `organization_members` om ON om.`organization_id` = c.`organization_id`
  WHERE c.`id` = NEW.`customer_id` AND om.`user_id` = NEW.`user_id`
    AND om.`role` = 'client'
)
BEGIN SELECT RAISE(ABORT, 'client contact account must be a client member of the company organization'); END;
--> statement-breakpoint
CREATE TRIGGER `customer_contacts_account_scope_update` BEFORE UPDATE OF `customer_id`, `user_id` ON `customer_contacts`
WHEN NEW.`user_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customers` c
  JOIN `organization_members` om ON om.`organization_id` = c.`organization_id`
  WHERE c.`id` = NEW.`customer_id` AND om.`user_id` = NEW.`user_id`
    AND om.`role` = 'client'
)
BEGIN SELECT RAISE(ABORT, 'client contact account must be a client member of the company organization'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_contacts_account_scope_insert` BEFORE INSERT ON `vendor_contacts`
WHEN NEW.`user_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v
  JOIN `organization_members` om ON om.`organization_id` = v.`organization_id`
  WHERE v.`id` = NEW.`vendor_id` AND om.`user_id` = NEW.`user_id`
    AND om.`role` IN ('subcontractor', 'supplier')
)
BEGIN SELECT RAISE(ABORT, 'vendor contact account must be a vendor member of the company organization'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_contacts_account_scope_update` BEFORE UPDATE OF `vendor_id`, `user_id` ON `vendor_contacts`
WHEN NEW.`user_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v
  JOIN `organization_members` om ON om.`organization_id` = v.`organization_id`
  WHERE v.`id` = NEW.`vendor_id` AND om.`user_id` = NEW.`user_id`
    AND om.`role` IN ('subcontractor', 'supplier')
)
BEGIN SELECT RAISE(ABORT, 'vendor contact account must be a vendor member of the company organization'); END;
--> statement-breakpoint
CREATE TABLE `contact_account_link_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE restrict,
  `person_kind` text NOT NULL CHECK (`person_kind` IN ('client_person', 'vendor_person')),
  `person_id` text NOT NULL,
  `previous_user_id` text,
  `next_user_id` text,
  `changed_by_user_id` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_account_link_events_person_idx` ON `contact_account_link_events` (`organization_id`, `person_kind`, `person_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `contact_account_link_events_no_update` BEFORE UPDATE ON `contact_account_link_events`
BEGIN SELECT RAISE(ABORT, 'contact account link events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `contact_account_link_events_no_delete` BEFORE DELETE ON `contact_account_link_events`
BEGIN SELECT RAISE(ABORT, 'contact account link events are immutable'); END;
