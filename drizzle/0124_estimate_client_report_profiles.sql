ALTER TABLE `estimate_terms_templates` ADD `department_code` text;
ALTER TABLE `estimate_terms_templates` ADD `template_type` text DEFAULT 'terms' NOT NULL;
ALTER TABLE `estimate_terms_templates` ADD `source_document_id` text;
ALTER TABLE `estimate_terms_templates` ADD `source_url` text;
ALTER TABLE `estimate_terms_templates` ADD `sort_order` integer DEFAULT 0 NOT NULL;

DROP INDEX `estimate_terms_templates_org_name_uq`;
DROP INDEX `estimate_terms_templates_org_active_idx`;
CREATE UNIQUE INDEX `estimate_terms_templates_org_department_type_name_uq`
  ON `estimate_terms_templates` (`organization_id`, `department_code`, `template_type`, `name`);
CREATE INDEX `estimate_terms_templates_org_active_idx`
  ON `estimate_terms_templates` (`organization_id`, `department_code`, `template_type`, `active`);

ALTER TABLE `project_estimates` ADD `introduction_template_id` text
  REFERENCES `estimate_terms_templates`(`id`) ON UPDATE no action ON DELETE set null;
ALTER TABLE `project_estimates` ADD `introduction_text` text;
ALTER TABLE `project_estimates` ADD `closing_template_id` text
  REFERENCES `estimate_terms_templates`(`id`) ON UPDATE no action ON DELETE set null;
ALTER TABLE `project_estimates` ADD `closing_text` text;

CREATE TABLE `project_estimate_phase_descriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `division_code` text NOT NULL,
  `description` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `project_estimate_phase_description_uq`
  ON `project_estimate_phase_descriptions` (`estimate_id`, `division_code`);
CREATE INDEX `project_estimate_phase_descriptions_project_idx`
  ON `project_estimate_phase_descriptions` (`project_id`, `estimate_id`);

CREATE TABLE `project_estimate_acknowledgements` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `template_id` text NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `source_document_id` text,
  `source_url` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `project_estimate_acknowledgements_template_uq`
  ON `project_estimate_acknowledgements` (`estimate_id`, `template_id`);
CREATE INDEX `project_estimate_acknowledgements_project_idx`
  ON `project_estimate_acknowledgements` (`project_id`, `estimate_id`, `sort_order`);

UPDATE `project_estimates`
SET `title` = CASE
  WHEN UPPER(SUBSTR(TRIM(COALESCE(
    (SELECT `project_number` FROM `projects` WHERE `projects`.`id` = `project_estimates`.`project_id`),
    `project_estimates`.`project_id`
  )), 1, 1)) = 'N' THEN 'Material Estimate'
  ELSE 'Construction Estimate'
END
WHERE `title` = 'CA22 Construction Estimate'
  AND UPPER(SUBSTR(TRIM(COALESCE(
    (SELECT `project_number` FROM `projects` WHERE `projects`.`id` = `project_estimates`.`project_id`),
    `project_estimates`.`project_id`
  )), 1, 1)) IN ('H', 'N');
