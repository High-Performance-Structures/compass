ALTER TABLE `project_estimate_line_cost_items` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `project_estimate_line_cost_items` ADD `deleted_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `project_estimate_line_cost_items_active_idx` ON `project_estimate_line_cost_items` (`estimate_line_id`,`deleted_at`,`sort_order`);
