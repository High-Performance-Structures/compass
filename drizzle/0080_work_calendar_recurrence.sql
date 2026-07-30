ALTER TABLE `work_calendar_events`
  ADD COLUMN `recurrence` text NOT NULL DEFAULT 'none'
  CHECK (`recurrence` IN ('none', 'daily', 'weekly', 'monthly', 'yearly'));
--> statement-breakpoint
ALTER TABLE `work_calendar_events`
  ADD COLUMN `recurrence_until` text;
