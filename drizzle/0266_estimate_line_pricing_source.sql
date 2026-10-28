-- "Priced by" on estimate lines: who prices the cost code (a pricing-source
-- id from the company's Estimate pricing settings) and the takeoff to-do made
-- for it, if any.
ALTER TABLE `project_estimate_lines` ADD COLUMN `pricing_source` text;
--> statement-breakpoint
ALTER TABLE `project_estimate_lines` ADD COLUMN `pricing_todo_id` text REFERENCES `project_operations`(`id`) ON DELETE set null;
