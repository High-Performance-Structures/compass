ALTER TABLE `project_change_orders`
  ADD `schedule_impact_days` integer;
--> statement-breakpoint
CREATE TABLE `project_change_order_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `change_order_id` text NOT NULL,
  `line_number` integer NOT NULL,
  `description` text NOT NULL,
  `phase_code` text,
  `cost_code` text,
  `amount_cents` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`change_order_id`) REFERENCES `project_change_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_change_order_lines_order_uq`
  ON `project_change_order_lines` (`change_order_id`, `line_number`);
--> statement-breakpoint
CREATE INDEX `project_change_order_lines_project_idx`
  ON `project_change_order_lines` (`project_id`);
--> statement-breakpoint
CREATE INDEX `project_change_order_lines_cost_code_idx`
  ON `project_change_order_lines` (`project_id`, `cost_code`);
