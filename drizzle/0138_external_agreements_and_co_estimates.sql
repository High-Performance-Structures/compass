ALTER TABLE `project_estimates`
  ADD `estimate_purpose` text DEFAULT 'contract' NOT NULL;

ALTER TABLE `project_estimates`
  ADD `change_order_id` text;

ALTER TABLE `project_estimate_lines`
  ADD `include_in_contract_budget` integer DEFAULT true NOT NULL;

CREATE INDEX `project_estimates_change_order_idx`
  ON `project_estimates` (`project_id`, `change_order_id`);

CREATE TABLE `project_agreements` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `agreement_type` text NOT NULL,
  `title` text NOT NULL,
  `agreement_number` text,
  `counterparty_name` text NOT NULL,
  `counterparty_role` text NOT NULL,
  `status` text DEFAULT 'executed' NOT NULL,
  `relationship_type` text DEFAULT 'governing' NOT NULL,
  `parent_agreement_id` text,
  `linked_estimate_id` text,
  `source_url` text NOT NULL,
  `source_label` text NOT NULL,
  `executed_at` text,
  `effective_at` text,
  `historical_notes` text,
  `internal_notes` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`linked_estimate_id`) REFERENCES `project_estimates` (`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `project_agreements_project_status_idx`
  ON `project_agreements` (`project_id`, `status`, `executed_at`);

CREATE INDEX `project_agreements_estimate_idx`
  ON `project_agreements` (`project_id`, `linked_estimate_id`);

CREATE INDEX `project_agreements_parent_idx`
  ON `project_agreements` (`project_id`, `parent_agreement_id`);
