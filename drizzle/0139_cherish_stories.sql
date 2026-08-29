ALTER TABLE `cherish_pulse_responses`
  ADD `audience_scope` text DEFAULT 'company' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cherish_pulse_responses`
  ADD `audience_reference_id` text;
--> statement-breakpoint
CREATE TABLE `cherish_pulse_story_states` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `response_id` text NOT NULL,
  `user_id` text NOT NULL,
  `viewed_at` text NOT NULL,
  `reacted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`response_id`) REFERENCES `cherish_pulse_responses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cherish_story_state_response_user_idx`
  ON `cherish_pulse_story_states` (`response_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `cherish_story_state_org_user_idx`
  ON `cherish_pulse_story_states` (`organization_id`, `user_id`);
