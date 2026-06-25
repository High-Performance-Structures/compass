CREATE TABLE `project_finish_selection_rooms` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_workbook_id` text,
  `source_sheet_id` text,
  `source_sheet_name` text,
  `room_name` text NOT NULL,
  `room_type` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_project_finish_selection_rooms_project` ON `project_finish_selection_rooms` (`project_id`);
CREATE INDEX `idx_project_finish_selection_rooms_source` ON `project_finish_selection_rooms` (`source_system`,`source_workbook_id`,`source_sheet_id`);
