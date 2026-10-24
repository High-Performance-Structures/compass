-- How each change order is built: its own estimate, a description with no
-- cost, a contract-estimate replacement, or a contract-version comparison.
-- Older change orders stay NULL and keep their recorded cost lines.
ALTER TABLE `project_change_orders` ADD `change_order_kind` text;
--> statement-breakpoint
UPDATE `project_change_orders` SET `change_order_kind` = 'replacement'
WHERE `budget_treatment` = 'baseline_replacement';
--> statement-breakpoint
UPDATE `project_change_orders` SET `change_order_kind` = 'contract_version'
WHERE `change_order_kind` IS NULL AND `source_type` = 'estimate_version';
--> statement-breakpoint
UPDATE `project_change_orders` SET `change_order_kind` = 'estimate'
WHERE `change_order_kind` IS NULL
  AND EXISTS (
    SELECT 1 FROM `project_estimates`
    WHERE `project_estimates`.`change_order_id` = `project_change_orders`.`id`
  );
