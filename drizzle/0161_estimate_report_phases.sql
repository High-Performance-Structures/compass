CREATE TABLE `project_estimate_report_phases` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `estimate_id` text NOT NULL REFERENCES `project_estimates`(`id`) ON DELETE CASCADE,
  `division_code` text NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `itemize` integer DEFAULT 0 NOT NULL,
  `sort_order` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_estimate_report_phases_estimate_order_idx` ON `project_estimate_report_phases` (`estimate_id`,`sort_order`);
--> statement-breakpoint
ALTER TABLE `project_estimate_lines` ADD `report_phase_id` text REFERENCES `project_estimate_report_phases`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `project_estimate_lines_report_phase_idx` ON `project_estimate_lines` (`report_phase_id`);
