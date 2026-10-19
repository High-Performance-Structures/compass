-- Phase proposals: one assembly of a contract estimate offered as a later
-- phase. Its estimate is approved on its own; only when it is accepted does
-- the assembly leave the contract estimate (or, once that is signed, a deduct
-- change order is drafted) and the project family phase get created.
CREATE TABLE `project_phase_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `phase_name` text NOT NULL,
  `assembly_name` text NOT NULL,
  `source_estimate_id` text,
  `source_estimate_number` text NOT NULL,
  `source_version_number` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'proposed',
  `family_phase_id` text REFERENCES `project_family_phases`(`id`) ON DELETE SET NULL,
  `contract_removal` text,
  `deduct_change_order_id` text,
  `accepted_at` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `project_phase_proposals_project_idx` ON `project_phase_proposals` (`project_id`, `created_at`);
-- Set on a phase proposal's estimates; null for contract and change-order
-- estimates. No foreign key, like change_order_id.
ALTER TABLE `project_estimates` ADD `phase_proposal_id` text;
CREATE INDEX `project_estimates_phase_proposal_idx` ON `project_estimates` (`project_id`, `phase_proposal_id`);
