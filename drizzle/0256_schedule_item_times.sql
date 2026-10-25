-- Optional times on schedule items ("HH:MM", project local time). Both NULL
-- means an all-day item, which is every existing item.
ALTER TABLE `schedule_tasks` ADD `start_time` text;
--> statement-breakpoint
ALTER TABLE `schedule_tasks` ADD `end_time` text;
