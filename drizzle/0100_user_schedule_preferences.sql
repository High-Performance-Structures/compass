CREATE TABLE `user_schedule_preferences` (
  `user_id` text PRIMARY KEY NOT NULL,
  `gantt_scroll_mode` text DEFAULT 'default' NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
