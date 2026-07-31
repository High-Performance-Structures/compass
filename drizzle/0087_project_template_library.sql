-- Follows 0086_change_order_cost_lines.sql on main.
CREATE TABLE `project_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_key` text NOT NULL,
  `source_template_id` text,
  `source_url` text,
  `name` text NOT NULL,
  `description` text,
  `template_kind` text DEFAULT 'assembly' NOT NULL,
  `department_code` text,
  `trade_category` text,
  `lifecycle_status` text DEFAULT 'draft' NOT NULL,
  `review_status` text DEFAULT 'inventory_only' NOT NULL,
  `current_version_number` integer,
  `source_metadata_json` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_templates_org_source_key_unique` ON `project_templates` (`organization_id`,`source_system`,`source_key`);
--> statement-breakpoint
CREATE INDEX `project_templates_org_status_idx` ON `project_templates` (`organization_id`,`lifecycle_status`);
--> statement-breakpoint
CREATE INDEX `project_templates_org_trade_idx` ON `project_templates` (`organization_id`,`trade_category`);
--> statement-breakpoint
CREATE TABLE `project_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `source_fingerprint` text,
  `source_captured_at` text,
  `notes` text,
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`template_id`) REFERENCES `project_templates`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_template_versions_template_number_unique` ON `project_template_versions` (`template_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `project_template_versions_status_idx` ON `project_template_versions` (`template_id`,`status`);
--> statement-breakpoint
CREATE TABLE `project_template_modules` (
  `id` text PRIMARY KEY NOT NULL,
  `version_id` text NOT NULL,
  `module_type` text NOT NULL,
  `source_item_count` integer DEFAULT 0 NOT NULL,
  `normalization_status` text DEFAULT 'inventory_only' NOT NULL,
  `source_payload_json` text,
  FOREIGN KEY (`version_id`) REFERENCES `project_template_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_template_modules_version_type_unique` ON `project_template_modules` (`version_id`,`module_type`);
--> statement-breakpoint
CREATE TABLE `schedule_template_items` (
  `id` text PRIMARY KEY NOT NULL,
  `version_id` text NOT NULL,
  `source_item_id` text,
  `item_key` text NOT NULL,
  `title` text NOT NULL,
  `start_offset_workdays` integer DEFAULT 0 NOT NULL,
  `workdays` integer DEFAULT 1 NOT NULL,
  `phase` text DEFAULT 'Unassigned / General' NOT NULL,
  `display_color` text DEFAULT 'blue' NOT NULL,
  `is_milestone` integer DEFAULT false NOT NULL,
  `assignee_placeholder` text,
  `owner_visible` integer DEFAULT true NOT NULL,
  `sub_vendor_visible` integer DEFAULT false NOT NULL,
  `notes` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`version_id`) REFERENCES `project_template_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_template_items_version_key_unique` ON `schedule_template_items` (`version_id`,`item_key`);
--> statement-breakpoint
CREATE INDEX `schedule_template_items_version_order_idx` ON `schedule_template_items` (`version_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `schedule_template_dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `version_id` text NOT NULL,
  `predecessor_item_id` text NOT NULL,
  `successor_item_id` text NOT NULL,
  `type` text DEFAULT 'FS' NOT NULL,
  `lag_days` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`version_id`) REFERENCES `project_template_versions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`predecessor_item_id`) REFERENCES `schedule_template_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`successor_item_id`) REFERENCES `schedule_template_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_template_dependencies_edge_unique` ON `schedule_template_dependencies` (`version_id`,`predecessor_item_id`,`successor_item_id`,`type`);
--> statement-breakpoint
CREATE TABLE `project_template_applications` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL,
  `template_id` text NOT NULL,
  `version_id` text NOT NULL,
  `anchor_date` text NOT NULL,
  `status` text DEFAULT 'applying' NOT NULL,
  `applied_by` text,
  `item_count` integer DEFAULT 0 NOT NULL,
  `dependency_count` integer DEFAULT 0 NOT NULL,
  `options_json` text,
  `created_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`template_id`) REFERENCES `project_templates`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`version_id`) REFERENCES `project_template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_template_applications_project_idx` ON `project_template_applications` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `project_template_applications_template_idx` ON `project_template_applications` (`template_id`,`status`);
--> statement-breakpoint
CREATE TABLE `project_template_application_items` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text NOT NULL,
  `template_item_id` text NOT NULL,
  `schedule_task_id` text NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `project_template_applications`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`template_item_id`) REFERENCES `schedule_template_items`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`schedule_task_id`) REFERENCES `schedule_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_template_application_items_task_unique` ON `project_template_application_items` (`schedule_task_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_template_application_items_source_unique` ON `project_template_application_items` (`application_id`,`template_item_id`);
