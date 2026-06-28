CREATE TABLE `sage_cost_codes` (
  `id` text PRIMARY KEY NOT NULL,
  `source_system` text DEFAULT 'sage' NOT NULL,
  `source_record_id` text,
  `source_record_number` text,
  `code` text NOT NULL,
  `description` text NOT NULL,
  `display_label` text NOT NULL,
  `division_code` text NOT NULL,
  `division_description` text NOT NULL,
  `division_display_label` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `sync_status` text DEFAULT 'synced' NOT NULL,
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `idx_sage_cost_codes_code` ON `sage_cost_codes` (`code`);
CREATE INDEX `idx_sage_cost_codes_division` ON `sage_cost_codes` (`division_code`);
CREATE INDEX `idx_sage_cost_codes_active` ON `sage_cost_codes` (`active`);
