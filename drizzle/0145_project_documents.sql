CREATE TABLE `project_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `category` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `document_date` text,
  `revision` text,
  `status` text DEFAULT 'current' NOT NULL,
  `audience` text DEFAULT 'project_team' NOT NULL,
  `downloadable` integer DEFAULT true NOT NULL,
  `source_drive_file_id` text NOT NULL,
  `source_file_name` text NOT NULL,
  `source_mime_type` text NOT NULL,
  `source_url` text,
  `source_checksum` text,
  `supersedes_document_id` text,
  `published_by` text,
  `published_at` text,
  `archived_at` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_documents_project_drive_file_uq` ON `project_documents` (`project_id`,`source_drive_file_id`);
--> statement-breakpoint
CREATE INDEX `project_documents_project_status_idx` ON `project_documents` (`project_id`,`status`,`category`);
--> statement-breakpoint
CREATE INDEX `project_documents_project_audience_idx` ON `project_documents` (`project_id`,`audience`,`status`);
--> statement-breakpoint
ALTER TABLE `project_estimate_basis_documents` ADD `project_document_id` text REFERENCES project_documents(id) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `project_estimate_basis_documents_project_document_idx` ON `project_estimate_basis_documents` (`project_document_id`);
