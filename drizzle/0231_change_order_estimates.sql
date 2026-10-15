ALTER TABLE `project_estimates` ADD COLUMN `change_order_id` text REFERENCES `project_change_orders`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `project_estimates_change_order_idx` ON `project_estimates` (`change_order_id`);
