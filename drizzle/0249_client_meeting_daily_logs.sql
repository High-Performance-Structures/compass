-- Each saved client meeting transcript also becomes an internal draft daily
-- log, so staff can review it and share it with the owner the usual way.
ALTER TABLE `project_client_meetings` ADD `daily_log_id` text REFERENCES `daily_logs`(`id`) ON DELETE set null;
