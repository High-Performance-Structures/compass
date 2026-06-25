CREATE TABLE `project_finish_selections` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_record_id` text,
  `source_workbook_id` text,
  `source_sheet_name` text,
  `room_name` text NOT NULL,
  `room_type` text,
  `category` text DEFAULT 'Uncategorized' NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `quantity` real,
  `manufacturer` text,
  `model` text,
  `color_finish` text,
  `supplier_name` text,
  `product_url` text,
  `cost_code` text,
  `phase_code` text,
  `status` text DEFAULT 'needed' NOT NULL,
  `owner_visible` integer DEFAULT false NOT NULL,
  `owner_approved` integer DEFAULT false NOT NULL,
  `approved_by` text,
  `approved_at` text,
  `rfq_operation_id` text,
  `purchase_order_operation_id` text,
  `notes` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `sync_status` text DEFAULT 'manual' NOT NULL,
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`rfq_operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`purchase_order_operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_project_finish_selections_project` ON `project_finish_selections` (`project_id`);
CREATE INDEX `idx_project_finish_selections_room` ON `project_finish_selections` (`project_id`,`room_name`);
CREATE INDEX `idx_project_finish_selections_status` ON `project_finish_selections` (`project_id`,`status`);
CREATE INDEX `idx_project_finish_selections_cost_code` ON `project_finish_selections` (`project_id`,`cost_code`);
CREATE INDEX `idx_project_finish_selections_source` ON `project_finish_selections` (`source_system`,`source_record_id`);
