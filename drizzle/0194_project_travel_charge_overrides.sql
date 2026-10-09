-- Per-job zone charge adjustments. Each column is optional: NULL keeps the
-- organization default from travel_charge_settings. Additive: no existing data
-- changes.
CREATE TABLE `project_travel_charge_overrides` (
  `project_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `zone_index` integer CHECK (`zone_index` IS NULL OR (`zone_index` >= 0 AND `zone_index` < 8)),
  `zone_rate_cents` integer CHECK (`zone_rate_cents` IS NULL OR (`zone_rate_cents` >= 0 AND `zone_rate_cents` <= 1000000)),
  `site_elevation_ft` integer CHECK (`site_elevation_ft` IS NULL OR (`site_elevation_ft` >= 0 AND `site_elevation_ft` <= 15000)),
  `mountain_rate_cents` integer CHECK (`mountain_rate_cents` IS NULL OR (`mountain_rate_cents` >= 0 AND `mountain_rate_cents` <= 1000000)),
  `lodging` text NOT NULL DEFAULT 'default' CHECK (`lodging` IN ('default', 'yes', 'no')),
  `lodging_per_night_cents` integer CHECK (`lodging_per_night_cents` IS NULL OR (`lodging_per_night_cents` >= 0 AND `lodging_per_night_cents` <= 1000000)),
  `per_diem_per_day_cents` integer CHECK (`per_diem_per_day_cents` IS NULL OR (`per_diem_per_day_cents` >= 0 AND `per_diem_per_day_cents` <= 1000000)),
  `note` text,
  `updated_at` text NOT NULL,
  `updated_by` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_travel_charge_overrides_org_idx`
  ON `project_travel_charge_overrides` (`organization_id`);
