ALTER TABLE `schedule_tasks`
  ADD `assigned_user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `owner_visible` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `sub_vendor_visible` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `confirmation_required` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `confirmation_status` text NOT NULL DEFAULT 'not_requested';
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `confirmation_requested_at` text;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `confirmation_responded_at` text;
--> statement-breakpoint
ALTER TABLE `schedule_tasks`
  ADD `reminder_sent_at` text;
