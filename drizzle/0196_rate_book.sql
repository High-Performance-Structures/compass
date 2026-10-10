-- Rate book: accepted rates estimators pick from, with a history of every
-- change. Estimate cost items can remember which entry and version filled
-- them. Additive: no existing data changes.
CREATE TABLE `rate_book_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL CHECK (`category` IN ('labor', 'machine', 'delivery', 'fuel', 'travel', 'lodging', 'rental', 'material', 'subcontract', 'other')),
  `unit` text NOT NULL,
  `unit_cost_cents` integer NOT NULL CHECK (`unit_cost_cents` >= 0 AND `unit_cost_cents` <= 100000000),
  `markup_basis_points` integer NOT NULL DEFAULT 0 CHECK (`markup_basis_points` >= 0 AND `markup_basis_points` <= 100000),
  `division_code` text,
  `division_name` text,
  `cost_code` text,
  `cost_code_name` text,
  `fuel_type` text NOT NULL DEFAULT 'none' CHECK (`fuel_type` IN ('none', 'diesel', 'regular')),
  `fuel_gallons_per_unit` real CHECK (`fuel_gallons_per_unit` IS NULL OR (`fuel_gallons_per_unit` >= 0 AND `fuel_gallons_per_unit` <= 1000)),
  `notes` text,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'retired')),
  `version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `created_by` text,
  `updated_at` text NOT NULL,
  `updated_by` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rate_book_entries_org_status_idx` ON `rate_book_entries` (`organization_id`, `status`, `category`);
--> statement-breakpoint
CREATE TABLE `rate_book_entry_history` (
  `id` text PRIMARY KEY NOT NULL,
  `entry_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `version` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `change_note` text,
  `changed_at` text NOT NULL,
  `changed_by` text,
  FOREIGN KEY (`entry_id`) REFERENCES `rate_book_entries`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rate_book_entry_history_entry_idx` ON `rate_book_entry_history` (`entry_id`, `version`);
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD COLUMN `rate_book_entry_id` text REFERENCES `rate_book_entries`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD COLUMN `rate_book_version` integer;
