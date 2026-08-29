CREATE TABLE `cherish_pulse_story_replies` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `response_id` text NOT NULL,
  `author_id` text NOT NULL,
  `recipient_id` text,
  `message` text NOT NULL,
  `deleted_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`response_id`) REFERENCES `cherish_pulse_responses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cherish_story_reply_response_created_idx`
  ON `cherish_pulse_story_replies` (`response_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `cherish_story_reply_recipient_created_idx`
  ON `cherish_pulse_story_replies` (`recipient_id`, `created_at`);
