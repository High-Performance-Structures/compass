-- A change-order estimate's assembly can name the contract assembly it adds
-- to or reduces; executed change-order lines and budget adjustments carry it,
-- so pay applications show the change inside that assembly.
ALTER TABLE `project_estimate_assemblies` ADD `contract_assembly_id` text;
--> statement-breakpoint
ALTER TABLE `project_change_order_lines` ADD `contract_assembly_id` text;
--> statement-breakpoint
ALTER TABLE `project_change_order_lines` ADD `assembly_name` text;
--> statement-breakpoint
ALTER TABLE `project_contract_budget_adjustments` ADD `contract_assembly_id` text;
--> statement-breakpoint
ALTER TABLE `project_contract_budget_adjustments` ADD `assembly_name` text;
