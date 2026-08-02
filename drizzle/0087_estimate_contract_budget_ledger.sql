CREATE TABLE `sage_tax_entities` (
  `id` text PRIMARY KEY NOT NULL,
  `source_record_id` text,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `rate_basis_points` integer DEFAULT 0 NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `sync_status` text DEFAULT 'synced' NOT NULL,
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `sage_tax_entities_code_uq` ON `sage_tax_entities` (`code`);
CREATE INDEX `sage_tax_entities_active_idx` ON `sage_tax_entities` (`active`,`name`);

CREATE TABLE `estimate_terms_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `body` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `estimate_terms_templates_org_name_uq` ON `estimate_terms_templates` (`organization_id`,`name`);
CREATE INDEX `estimate_terms_templates_org_active_idx` ON `estimate_terms_templates` (`organization_id`,`active`);

CREATE TABLE `project_estimates` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_number` text NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `title` text DEFAULT 'CA22 Construction Estimate' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `estimate_date` text,
  `client_name` text,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_workbook_id` text,
  `source_workbook_url` text,
  `source_revision` text,
  `default_tax_entity_id` text,
  `default_tax_code` text,
  `default_tax_name` text,
  `default_tax_rate_basis_points` integer DEFAULT 0 NOT NULL,
  `terms_template_id` text,
  `contract_terms` text,
  `direct_cost_cents` integer DEFAULT 0 NOT NULL,
  `markup_cents` integer DEFAULT 0 NOT NULL,
  `tax_cents` integer DEFAULT 0 NOT NULL,
  `estimate_total_cents` integer DEFAULT 0 NOT NULL,
  `foxit_status` text DEFAULT 'not_started' NOT NULL,
  `foxit_envelope_id` text,
  `signature_package_url` text,
  `signature_requested_at` text,
  `signed_at` text,
  `accepted_at` text,
  `accepted_by` text,
  `sage_status` text DEFAULT 'not_ready' NOT NULL,
  `sage_record_id` text,
  `last_sage_sync_at` text,
  `source_hash` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`default_tax_entity_id`) REFERENCES `sage_tax_entities`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`terms_template_id`) REFERENCES `estimate_terms_templates`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_estimates_project_number_version_uq` ON `project_estimates` (`project_id`,`estimate_number`,`version_number`);
CREATE INDEX `project_estimates_project_status_idx` ON `project_estimates` (`project_id`,`status`,`version_number`);

CREATE TABLE `project_estimate_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `division_code` text NOT NULL,
  `division_name` text NOT NULL,
  `cost_code` text NOT NULL,
  `cost_code_name` text NOT NULL,
  `description` text NOT NULL,
  `specifications` text,
  `quantity` real DEFAULT 1 NOT NULL,
  `unit` text DEFAULT 'LS' NOT NULL,
  `unit_cost_cents` integer DEFAULT 0 NOT NULL,
  `direct_cost_cents` integer DEFAULT 0 NOT NULL,
  `markup_rate_basis_points` integer DEFAULT 0 NOT NULL,
  `markup_cents` integer DEFAULT 0 NOT NULL,
  `taxable` integer DEFAULT false NOT NULL,
  `tax_entity_id` text,
  `tax_code` text,
  `tax_name` text,
  `tax_rate_basis_points` integer DEFAULT 0 NOT NULL,
  `tax_cents` integer DEFAULT 0 NOT NULL,
  `line_total_cents` integer DEFAULT 0 NOT NULL,
  `owner_visible` integer DEFAULT true NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tax_entity_id`) REFERENCES `sage_tax_entities`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `project_estimate_lines_estimate_order_idx` ON `project_estimate_lines` (`estimate_id`,`division_code`,`sort_order`);
CREATE INDEX `project_estimate_lines_project_cost_code_idx` ON `project_estimate_lines` (`project_id`,`cost_code`);

CREATE TABLE `project_estimate_basis_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `document_type` text NOT NULL,
  `title` text NOT NULL,
  `document_date` text,
  `revision` text,
  `drive_file_id` text,
  `drive_url` text,
  `notes` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `project_estimate_basis_documents_estimate_idx` ON `project_estimate_basis_documents` (`estimate_id`,`sort_order`);

CREATE TABLE `project_contract_budget_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `accepted_estimate_id` text NOT NULL,
  `revision_number` integer NOT NULL,
  `status` text DEFAULT 'current' NOT NULL,
  `original_contract_sum_cents` integer DEFAULT 0 NOT NULL,
  `approved_changes_cents` integer DEFAULT 0 NOT NULL,
  `revised_contract_sum_cents` integer DEFAULT 0 NOT NULL,
  `effective_at` text NOT NULL,
  `source_hash` text NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`accepted_estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_contract_budget_revision_number_uq` ON `project_contract_budget_revisions` (`project_id`,`revision_number`);
CREATE UNIQUE INDEX `project_contract_budget_source_hash_uq` ON `project_contract_budget_revisions` (`project_id`,`source_hash`);
CREATE INDEX `project_contract_budget_current_idx` ON `project_contract_budget_revisions` (`project_id`,`status`,`revision_number`);

CREATE TABLE `project_contract_budget_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `source_estimate_line_id` text,
  `division_code` text NOT NULL,
  `division_name` text NOT NULL,
  `cost_code` text NOT NULL,
  `description` text NOT NULL,
  `original_estimate_cents` integer DEFAULT 0 NOT NULL,
  `approved_change_cents` integer DEFAULT 0 NOT NULL,
  `adjusted_budget_cents` integer DEFAULT 0 NOT NULL,
  `owner_visible` integer DEFAULT true NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`revision_id`) REFERENCES `project_contract_budget_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_estimate_line_id`) REFERENCES `project_estimate_lines`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_contract_budget_line_cost_code_uq` ON `project_contract_budget_lines` (`revision_id`,`cost_code`);
CREATE INDEX `project_contract_budget_lines_project_idx` ON `project_contract_budget_lines` (`project_id`,`revision_id`);

CREATE TABLE `project_contract_budget_adjustments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `change_order_id` text NOT NULL,
  `change_order_line_id` text NOT NULL,
  `cost_code` text NOT NULL,
  `description` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `executed_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`revision_id`) REFERENCES `project_contract_budget_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `project_contract_budget_adjustment_line_uq` ON `project_contract_budget_adjustments` (`revision_id`,`change_order_line_id`);
CREATE INDEX `project_contract_budget_adjustments_change_order_idx` ON `project_contract_budget_adjustments` (`project_id`,`change_order_id`);

ALTER TABLE `project_budget_applications` ADD `budget_revision_id` text;
ALTER TABLE `project_budget_lines` ADD `budget_revision_line_id` text;
ALTER TABLE `project_budget_lines` ADD `previous_work_completed` real DEFAULT 0 NOT NULL;
ALTER TABLE `project_budget_lines` ADD `current_work_completed` real DEFAULT 0 NOT NULL;
ALTER TABLE `project_budget_lines` ADD `stored_materials` real DEFAULT 0 NOT NULL;
