-- Migration 0165 follows the change-order 0163 and cutover-provenance 0164 migrations.
-- Canonical companies keep Sage-aligned address fields; legacy flattened
-- fields remain for old clients until their readers have been migrated.
ALTER TABLE `customers` ADD `address_line_1` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `address_line_2` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `city` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `state` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `postal_code` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `billing_address_line_1` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `billing_address_line_2` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `billing_city` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `billing_state` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `billing_postal_code` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `primary_email` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `owner_name` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `address_line_1` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `address_line_2` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `city` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `state` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `postal_code` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `primary_email` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `sage_vendor_id` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `sage_vendor_number` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_org_sage_vendor_id_unique` ON `vendors` (`organization_id`, `sage_vendor_id`) WHERE `sage_vendor_id` IS NOT NULL AND trim(`sage_vendor_id`) <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_org_sage_vendor_number_unique` ON `vendors` (`organization_id`, `sage_vendor_number`) WHERE `sage_vendor_number` IS NOT NULL AND trim(`sage_vendor_number`) <> '';
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `phone_extension` text;
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `cell_phone` text;
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `sage_contact_id` text;
--> statement-breakpoint
ALTER TABLE `vendor_contacts` ADD `sage_line_number` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_contacts_vendor_sage_contact_unique` ON `vendor_contacts` (`vendor_id`, `sage_contact_id`) WHERE `sage_contact_id` IS NOT NULL AND trim(`sage_contact_id`) <> '';
--> statement-breakpoint
CREATE TABLE `customer_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `customer_id` text NOT NULL REFERENCES `customers`(`id`) ON DELETE cascade,
  `name` text NOT NULL,
  `title` text,
  `email` text,
  `phone` text,
  `phone_extension` text,
  `cell_phone` text,
  `sage_contact_id` text,
  `sage_line_number` integer,
  `is_primary` integer NOT NULL DEFAULT 0,
  `active` integer NOT NULL DEFAULT 1,
  `source_system` text NOT NULL DEFAULT 'manual',
  `source_record_id` text,
  `sync_status` text NOT NULL DEFAULT 'manual',
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_contacts_customer_active_idx` ON `customer_contacts` (`customer_id`, `active`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contacts_customer_sage_contact_unique` ON `customer_contacts` (`customer_id`, `sage_contact_id`) WHERE `sage_contact_id` IS NOT NULL AND trim(`sage_contact_id`) <> '';
--> statement-breakpoint
CREATE TABLE `internal_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `user_id` text REFERENCES `users`(`id`) ON DELETE set null,
  `name` text NOT NULL,
  `job_title` text,
  `email` text,
  `phone` text,
  `cell_phone` text,
  `sage_employee_id` text,
  `sage_employee_number` text,
  `source_system` text NOT NULL DEFAULT 'manual',
  `source_record_id` text,
  `active` integer NOT NULL DEFAULT 1,
  `sync_status` text NOT NULL DEFAULT 'manual',
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `internal_contacts_org_active_idx` ON `internal_contacts` (`organization_id`, `active`);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_contacts_org_user_unique` ON `internal_contacts` (`organization_id`, `user_id`) WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_contacts_org_sage_employee_unique` ON `internal_contacts` (`organization_id`, `sage_employee_id`) WHERE `sage_employee_id` IS NOT NULL AND trim(`sage_employee_id`) <> '';
--> statement-breakpoint
CREATE TABLE `internal_contact_private_addresses` (
  `internal_contact_id` text PRIMARY KEY NOT NULL REFERENCES `internal_contacts`(`id`) ON DELETE cascade,
  `address_line_1` text,
  `address_line_2` text,
  `city` text,
  `state` text,
  `postal_code` text,
  `last_synced_at` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `customer_id` text REFERENCES `customers`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `customer_contact_id` text REFERENCES `customer_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `internal_contact_id` text REFERENCES `internal_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `project_contacts_customer_contact_idx` ON `project_contacts` (`customer_contact_id`);
--> statement-breakpoint
CREATE INDEX `project_contacts_internal_contact_idx` ON `project_contacts` (`internal_contact_id`);
--> statement-breakpoint
-- An existing customer-directory link identifies a company, not a specific
-- person. Do not infer or create a person by name/email in this migration.
UPDATE `project_contacts`
SET `customer_id` = `source_entity_id`
WHERE `source_entity_type` = 'customer'
  AND EXISTS (
    SELECT 1 FROM `customers` c
    JOIN `projects` p ON p.`id` = `project_contacts`.`project_id`
    WHERE c.`id` = `project_contacts`.`source_entity_id`
      AND c.`organization_id` = p.`organization_id`
  );
--> statement-breakpoint
-- One-time bootstrap from staff identities. This does not make Settings the
-- directory's future source of truth; Sage employee IDs are linked separately.
INSERT INTO `internal_contacts` (
  `id`, `organization_id`, `user_id`, `name`, `email`, `phone`,
  `source_system`, `source_record_id`, `active`, `sync_status`,
  `created_at`, `updated_at`
)
SELECT
  'internal-contact-user-' || om.`organization_id` || '-' || u.`id`,
  om.`organization_id`,
  u.`id`,
  COALESCE(NULLIF(trim(u.`display_name`), ''),
    NULLIF(trim(COALESCE(u.`first_name`, '') || ' ' || COALESCE(u.`last_name`, '')), ''),
    u.`email`),
  u.`email`,
  u.`phone`,
  'compass_user',
  u.`id`,
  1,
  'manual',
  COALESCE(u.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(u.`updated_at`, u.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM `organization_members` om
JOIN `users` u ON u.`id` = om.`user_id`
JOIN `organizations` o ON o.`id` = om.`organization_id`
WHERE u.`is_active` = 1
  AND o.`type` = 'internal'
  AND om.`role` IN (
    'admin', 'secondary_admin', 'executive', 'project_manager',
    'project_administrator', 'assistant_project_manager', 'accounting',
    'office_manager', 'office', 'field_superintendent', 'field_crew',
    'architectural_designer', 'drafter', 'lead_estimator',
    'assistant_estimator', 'coordinator', 'field'
  )
GROUP BY om.`organization_id`, u.`id`;
--> statement-breakpoint
-- Link only by validated user ID within the project's organization.
UPDATE `project_contacts`
SET `internal_contact_id` = (
  SELECT ic.`id`
  FROM `internal_contacts` ic
  JOIN `projects` p ON p.`organization_id` = ic.`organization_id`
  WHERE p.`id` = `project_contacts`.`project_id`
    AND ic.`user_id` = `project_contacts`.`source_entity_id`
  LIMIT 1
)
WHERE `contact_type` = 'internal'
  AND `source_entity_type` = 'user'
  AND `source_entity_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `internal_contacts` ic
    JOIN `projects` p ON p.`organization_id` = ic.`organization_id`
    WHERE p.`id` = `project_contacts`.`project_id`
      AND ic.`user_id` = `project_contacts`.`source_entity_id`
  );
--> statement-breakpoint
-- Existing project_contacts cannot acquire composite foreign keys with ADD
-- COLUMN in SQLite. Guard every new/changed canonical link at the DB boundary.
CREATE TRIGGER `project_contacts_directory_scope_insert`
BEFORE INSERT ON `project_contacts`
WHEN (
  NEW.`customer_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `customers` c JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE c.`id` = NEW.`customer_id` AND c.`organization_id` = p.`organization_id`
  )
  OR NEW.`customer_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `customer_contacts` cc
    JOIN `customers` c ON c.`id` = cc.`customer_id`
    JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE cc.`id` = NEW.`customer_contact_id`
      AND c.`id` = NEW.`customer_id`
      AND c.`organization_id` = p.`organization_id`
  )
  OR NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
  )
  OR NEW.`vendor_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `vendor_contacts` vc
    JOIN `vendors` v ON v.`id` = vc.`vendor_id`
    JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE vc.`id` = NEW.`vendor_contact_id`
      AND v.`id` = NEW.`vendor_id`
      AND v.`organization_id` = p.`organization_id`
  )
  OR NEW.`internal_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `internal_contacts` ic JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE ic.`id` = NEW.`internal_contact_id` AND ic.`organization_id` = p.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'project contact directory link must belong to the project organization and parent company');
END;
--> statement-breakpoint
CREATE TRIGGER `project_contacts_directory_scope_update`
BEFORE UPDATE OF `project_id`, `customer_id`, `customer_contact_id`, `vendor_id`, `vendor_contact_id`, `internal_contact_id` ON `project_contacts`
WHEN (
  NEW.`customer_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `customers` c JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE c.`id` = NEW.`customer_id` AND c.`organization_id` = p.`organization_id`
  )
  OR NEW.`customer_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `customer_contacts` cc
    JOIN `customers` c ON c.`id` = cc.`customer_id`
    JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE cc.`id` = NEW.`customer_contact_id`
      AND c.`id` = NEW.`customer_id`
      AND c.`organization_id` = p.`organization_id`
  )
  OR NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
  )
  OR NEW.`vendor_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `vendor_contacts` vc
    JOIN `vendors` v ON v.`id` = vc.`vendor_id`
    JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE vc.`id` = NEW.`vendor_contact_id`
      AND v.`id` = NEW.`vendor_id`
      AND v.`organization_id` = p.`organization_id`
  )
  OR NEW.`internal_contact_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `internal_contacts` ic JOIN `projects` p ON p.`id` = NEW.`project_id`
    WHERE ic.`id` = NEW.`internal_contact_id` AND ic.`organization_id` = p.`organization_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'project contact directory link must belong to the project organization and parent company');
END;
