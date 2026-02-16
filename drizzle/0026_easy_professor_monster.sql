ALTER TABLE `customers` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `vendors` ADD `organization_id` text REFERENCES organizations(id);