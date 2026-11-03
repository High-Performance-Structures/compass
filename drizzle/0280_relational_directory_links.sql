-- Relational links to the contact directory: records that held only a typed
-- copy of a party (client name, vendor name, RFI assignee) gain a nullable
-- foreign key to the directory row. The copied text stays as the fallback
-- (and, for a sent RFQ or PO, the snapshot of what was sent); reads prefer the
-- linked record. scripts/relational-links-backfill.mjs fills the links by
-- exact match only.
-- Additive only: new nullable columns, indexes and validation triggers. No
-- table rebuild and no row changes.
ALTER TABLE `projects` ADD `client_customer_id` text REFERENCES `customers`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_client_customer_id_idx` ON `projects` (`client_customer_id`);
--> statement-breakpoint
ALTER TABLE `project_operations` ADD `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_operations_vendor_id_idx` ON `project_operations` (`vendor_id`);
--> statement-breakpoint
ALTER TABLE `project_budget_lines` ADD `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_budget_lines_vendor_id_idx` ON `project_budget_lines` (`vendor_id`);
--> statement-breakpoint
ALTER TABLE `project_rfis` ADD `assigned_project_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_rfis_assigned_project_contact_id_idx` ON `project_rfis` (`assigned_project_contact_id`);
--> statement-breakpoint
-- A link may only point inside the record's own company (project for RFIs),
-- following the 0165 project_contacts scope triggers.
CREATE TRIGGER IF NOT EXISTS `projects_client_customer_scope_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`client_customer_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customers` c
  WHERE c.`id` = NEW.`client_customer_id` AND c.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project client must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_client_customer_scope_update`
BEFORE UPDATE OF `client_customer_id`, `organization_id` ON `projects`
WHEN NEW.`client_customer_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `customers` c
  WHERE c.`id` = NEW.`client_customer_id` AND c.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project client must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_operations_vendor_scope_insert`
BEFORE INSERT ON `project_operations`
WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
  WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'operation vendor must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_operations_vendor_scope_update`
BEFORE UPDATE OF `vendor_id`, `project_id` ON `project_operations`
WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
  WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'operation vendor must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_lines_vendor_scope_insert`
BEFORE INSERT ON `project_budget_lines`
WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
  WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'budget line vendor must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_budget_lines_vendor_scope_update`
BEFORE UPDATE OF `vendor_id`, `project_id` ON `project_budget_lines`
WHEN NEW.`vendor_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `vendors` v JOIN `projects` p ON p.`id` = NEW.`project_id`
  WHERE v.`id` = NEW.`vendor_id` AND v.`organization_id` = p.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'budget line vendor must belong to the project organization');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_rfis_assigned_contact_scope_insert`
BEFORE INSERT ON `project_rfis`
WHEN NEW.`assigned_project_contact_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `project_contacts` pc
  WHERE pc.`id` = NEW.`assigned_project_contact_id` AND pc.`project_id` = NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'RFI assignee must be a contact on the same project');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_rfis_assigned_contact_scope_update`
BEFORE UPDATE OF `assigned_project_contact_id`, `project_id` ON `project_rfis`
WHEN NEW.`assigned_project_contact_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `project_contacts` pc
  WHERE pc.`id` = NEW.`assigned_project_contact_id` AND pc.`project_id` = NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'RFI assignee must be a contact on the same project');
END;
