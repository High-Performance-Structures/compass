-- Sage's vendor list carries more than names so Compass can keep linked
-- vendors' name, owner, address, phone, email and category in step with Sage
-- on the writer's daily push. details_received stays 0 for rows sent by an
-- older writer, so their blank columns are never read as "Sage holds blanks".
-- Additive only: nullable columns plus one flag with a default.
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `details_received` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `owner_name` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `address_line_1` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `address_line_2` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `city` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `state` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `postal_code` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `phone` text;
--> statement-breakpoint
ALTER TABLE `sage_vendor_directory_entries` ADD COLUMN `vendor_type` text;
