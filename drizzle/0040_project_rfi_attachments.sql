CREATE TABLE `project_rfi_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `rfi_id` text NOT NULL,
  `file_name` text NOT NULL,
  `mime_type` text,
  `file_size` integer NOT NULL DEFAULT 0,
  `storage_provider` text NOT NULL DEFAULT 'google_drive',
  `storage_id` text,
  `storage_url` text,
  `storage_status` text NOT NULL DEFAULT 'uploaded',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`rfi_id`) REFERENCES `project_rfis`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_project_rfi_attachments_project_id` ON `project_rfi_attachments` (`project_id`);
CREATE INDEX `idx_project_rfi_attachments_rfi_id` ON `project_rfi_attachments` (`rfi_id`);
CREATE INDEX `idx_project_rfi_attachments_storage_id` ON `project_rfi_attachments` (`storage_id`);
