ALTER TABLE `project_estimates` ADD `builder_fee_base_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `overhead_rate_basis_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `overhead_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `margin_rate_basis_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `margin_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `contingency_rate_basis_points` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `contingency_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimates` ADD `builder_fee_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_estimate_lines` ADD `include_in_builder_fee` integer DEFAULT true NOT NULL;
--> statement-breakpoint

-- Existing estimate lines are builder-fee eligible by default. Legacy
-- Division 99 adjustment rows are deliberately preserved for auditability;
-- re-importing their source CSI converts the editable draft to the new model.
UPDATE `project_estimates`
SET `builder_fee_base_cents` = COALESCE((
  SELECT SUM(`line_total_cents`)
  FROM `project_estimate_lines`
  WHERE `project_estimate_lines`.`estimate_id` = `project_estimates`.`id`
), 0);
