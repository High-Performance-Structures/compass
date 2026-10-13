-- A Nu-Tech job can have several orders (bracing, block for phase 1, block
-- for phase 2, ...). Each order is numbered on its job and fills its own
-- estimate. Existing orders become order 1 and keep the job's current estimate.
ALTER TABLE `nutech_order_workflows` ADD `order_number` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `title` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `estimate_id` text REFERENCES `project_estimates`(`id`) ON DELETE set null;
--> statement-breakpoint
UPDATE `nutech_order_workflows`
SET `estimate_id` = (
  SELECT `e`.`id` FROM `project_estimates` `e`
  WHERE `e`.`project_id` = `nutech_order_workflows`.`project_id`
  ORDER BY `e`.`updated_at` DESC
  LIMIT 1
);
--> statement-breakpoint
DROP INDEX IF EXISTS `nutech_order_workflows_project_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_order_workflows_project_number_uq` ON `nutech_order_workflows` (`project_id`, `order_number`);
--> statement-breakpoint
CREATE INDEX `nutech_order_workflows_estimate_idx` ON `nutech_order_workflows` (`estimate_id`);
