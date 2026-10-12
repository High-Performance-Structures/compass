-- Warranty claims remember which Compass contact they are assigned to, so a
-- sub/vendor sees only the claims assigned to them or their company.
-- Additive: two nullable columns and indexes; existing rows are unchanged.
ALTER TABLE `project_warranty_claims` ADD COLUMN `assigned_project_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_warranty_claims` ADD COLUMN `assigned_vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `project_warranty_claims_assigned_contact_idx` ON `project_warranty_claims` (`project_id`, `assigned_project_contact_id`);
--> statement-breakpoint
CREATE INDEX `project_warranty_claims_assigned_vendor_idx` ON `project_warranty_claims` (`project_id`, `assigned_vendor_id`);
