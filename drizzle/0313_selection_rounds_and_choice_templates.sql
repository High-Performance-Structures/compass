-- Which company selection round (Settings > Selections) a selection belongs to. Null: no round.
ALTER TABLE `project_finish_selections` ADD `round_key` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_finish_selections_round_idx` ON `project_finish_selections` (`project_id`,`round_key`);--> statement-breakpoint
-- "Round ready to finalize" was sent for this job and round (staff are alerted once; the row is removed if a pick is cleared, so the alert can come again).
CREATE TABLE IF NOT EXISTS `project_selection_round_alerts` (
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `round_key` text NOT NULL,
  `alerted_at` text NOT NULL,
  PRIMARY KEY(`project_id`, `round_key`)
);--> statement-breakpoint
-- Company choice-template library: a named set of choices to apply to any job's selection.
CREATE TABLE IF NOT EXISTS `selection_choice_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `name` text NOT NULL,
  `category` text,
  `description` text,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `selection_choice_templates_org_name_unique` ON `selection_choice_templates` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `selection_choice_templates_created_by_idx` ON `selection_choice_templates` (`created_by`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `selection_choice_template_items` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL REFERENCES `selection_choice_templates`(`id`) ON DELETE cascade,
  `title` text NOT NULL,
  `description` text,
  `price_cents` integer,
  `owner_price_cents` integer,
  `lead_time_days` integer,
  `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null,
  `supplier_name` text,
  `product_url` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `selection_choice_template_items_template_idx` ON `selection_choice_template_items` (`template_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `selection_choice_template_items_vendor_id_idx` ON `selection_choice_template_items` (`vendor_id`);
