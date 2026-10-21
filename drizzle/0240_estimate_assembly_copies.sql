-- Estimate assemblies copied into another job's estimate (e.g. a general
-- contract job's scope offered as subcontract work on a linked job). The
-- source estimate is never changed; these rows show where a copy went.
CREATE TABLE `project_estimate_assembly_copies` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `source_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `source_estimate_id` text NOT NULL,
  `source_assembly_id` text,
  `assembly_name` text NOT NULL,
  `target_project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `target_estimate_id` text NOT NULL,
  `target_estimate_number` text NOT NULL,
  `line_count` integer NOT NULL DEFAULT 0,
  `markup_rate_basis_points` integer,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL
);
CREATE INDEX `project_estimate_assembly_copies_source_idx` ON `project_estimate_assembly_copies` (`source_estimate_id`, `created_at`);
CREATE INDEX `project_estimate_assembly_copies_target_idx` ON `project_estimate_assembly_copies` (`target_project_id`, `created_at`);
