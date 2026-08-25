ALTER TABLE `project_estimate_line_cost_items` ADD `direct_cost_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `markup_rate_basis_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `markup_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `taxable` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `tax_entity_id` text REFERENCES `sage_tax_entities`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `tax_code` text;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `tax_name` text;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `tax_rate_basis_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `tax_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `line_total_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `project_estimate_line_cost_items`
SET `direct_cost_cents` = `total_cost_cents`;
--> statement-breakpoint
UPDATE `project_estimate_line_cost_items`
SET `markup_rate_basis_points` = COALESCE((
      SELECT `markup_rate_basis_points`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ), 0),
    `taxable` = COALESCE((
      SELECT `taxable`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ), false),
    `tax_entity_id` = (
      SELECT `tax_entity_id`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ),
    `tax_code` = (
      SELECT `tax_code`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ),
    `tax_name` = (
      SELECT `tax_name`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ),
    `tax_rate_basis_points` = COALESCE((
      SELECT `tax_rate_basis_points`
      FROM `project_estimate_lines`
      WHERE `project_estimate_lines`.`id` = `project_estimate_line_cost_items`.`estimate_line_id`
    ), 0);
--> statement-breakpoint
UPDATE `project_estimate_line_cost_items`
SET `markup_cents` = CAST(ROUND(
  `direct_cost_cents` * `markup_rate_basis_points` / 10000.0
) AS integer);
--> statement-breakpoint
UPDATE `project_estimate_line_cost_items`
SET `tax_cents` = CASE
  WHEN `taxable` THEN CAST(ROUND(
    (`direct_cost_cents` + `markup_cents`) * `tax_rate_basis_points` / 10000.0
  ) AS integer)
  ELSE 0
END;
--> statement-breakpoint
UPDATE `project_estimate_line_cost_items`
SET `line_total_cents` = `direct_cost_cents` + `markup_cents` + `tax_cents`,
    `total_cost_cents` = `direct_cost_cents` + `markup_cents` + `tax_cents`;
