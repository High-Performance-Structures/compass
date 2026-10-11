-- Project paper trail: before a record's first Drive copy, Compass looks for a
-- file someone already saved by hand and waits for a choice instead of
-- writing a duplicate beside it.
ALTER TABLE `project_record_drive_files` ADD `existing_file_id` text;
--> statement-breakpoint
ALTER TABLE `project_record_drive_files` ADD `existing_file_name` text;
--> statement-breakpoint
ALTER TABLE `project_record_drive_files` ADD `allow_duplicate` integer DEFAULT 0 NOT NULL;
