CREATE TABLE `project_audience_files` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `audience` text NOT NULL CHECK (`audience` IN ('owner', 'sub_vendor')),
  `uploaded_by` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `folder_id` text NOT NULL,
  `drive_file_id` text,
  `drive_url` text,
  `file_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `file_size` integer NOT NULL CHECK (`file_size` > 0),
  `upload_status` text NOT NULL DEFAULT 'pending' CHECK (`upload_status` IN ('pending', 'uploaded', 'failed')),
  `created_at` text NOT NULL,
  `uploaded_at` text
);
--> statement-breakpoint
CREATE INDEX `project_audience_files_project_audience_created_idx`
  ON `project_audience_files` (`project_id`, `audience`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX `project_audience_files_quota_idx`
  ON `project_audience_files` (`project_id`, `uploaded_by`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_audience_files_drive_file_id_unique`
  ON `project_audience_files` (`drive_file_id`);
--> statement-breakpoint
CREATE TRIGGER `project_audience_files_organization_guard_insert`
BEFORE INSERT ON `project_audience_files`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `projects`.`id` = NEW.`project_id`
    AND `projects`.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project audience files must remain organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `project_audience_files_organization_guard_update`
BEFORE UPDATE OF `organization_id`, `project_id` ON `project_audience_files`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `projects`.`id` = NEW.`project_id`
    AND `projects`.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project audience files must remain organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `project_audience_files_rolling_quota_guard`
BEFORE INSERT ON `project_audience_files`
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(`file_size`), 0)
  FROM `project_audience_files`
  WHERE `organization_id` = NEW.`organization_id`
    AND `project_id` = NEW.`project_id`
    AND `uploaded_by` = NEW.`uploaded_by`
    AND `upload_status` IN ('pending', 'uploaded')
    AND julianday(`created_at`) >= julianday('now', '-30 days')
) + NEW.`file_size` > 104857600
BEGIN
  SELECT RAISE(ABORT, 'external project file rolling quota exceeded');
END;
