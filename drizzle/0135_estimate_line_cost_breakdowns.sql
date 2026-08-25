CREATE TABLE `project_estimate_line_cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`estimate_id` text NOT NULL,
	`estimate_line_id` text NOT NULL,
	`division_code` text NOT NULL,
	`division_name` text NOT NULL,
	`cost_code` text NOT NULL,
	`cost_code_name` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`total_cost_cents` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_line_id`) REFERENCES `project_estimate_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_estimate_line_cost_items_line_order_idx` ON `project_estimate_line_cost_items` (`estimate_line_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `project_estimate_line_cost_items_estimate_idx` ON `project_estimate_line_cost_items` (`estimate_id`,`estimate_line_id`);
