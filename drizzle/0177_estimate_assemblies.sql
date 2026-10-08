CREATE TABLE `project_estimate_assemblies` (
  `id` text PRIMARY KEY NOT NULL,
  `estimate_id` text NOT NULL REFERENCES `project_estimates` (`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `description` text,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_estimate_assemblies_order_idx`
ON `project_estimate_assemblies` (`estimate_id`, `sort_order`);
--> statement-breakpoint
ALTER TABLE `project_estimate_lines` ADD `assembly_id` text
REFERENCES `project_estimate_assemblies` (`id`) ON DELETE SET NULL;
