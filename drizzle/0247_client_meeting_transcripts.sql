-- After a client Google Meet ends, Compass looks for its transcript and saves
-- a PDF copy in the project's Communications folder.
-- transcript_status: NULL (not checked yet), 'pending', 'saved', 'none', 'error'.
ALTER TABLE `project_client_meetings` ADD `transcript_status` text;
--> statement-breakpoint
ALTER TABLE `project_client_meetings` ADD `transcript_drive_file_id` text;
--> statement-breakpoint
ALTER TABLE `project_client_meetings` ADD `transcript_url` text;
--> statement-breakpoint
ALTER TABLE `project_client_meetings` ADD `transcript_error` text;
--> statement-breakpoint
ALTER TABLE `project_client_meetings` ADD `transcript_checked_at` text;
