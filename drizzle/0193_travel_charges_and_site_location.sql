-- Zone (travel) and mountain charges: cached site coordinates and elevation on
-- projects, and per-organization rate settings. Additive: no existing data
-- changes.
ALTER TABLE `projects` ADD COLUMN `site_latitude` real;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `site_longitude` real;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `site_elevation_ft` integer;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `site_location_address` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `site_location_status` text
  CHECK (`site_location_status` IS NULL OR `site_location_status` IN ('found', 'not_found'));
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `site_located_at` text;
--> statement-breakpoint
CREATE TABLE `travel_charge_settings` (
  `organization_id` text PRIMARY KEY NOT NULL,
  `settings_json` text NOT NULL,
  `updated_at` text NOT NULL,
  `updated_by` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
