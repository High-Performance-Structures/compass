CREATE TABLE `project_email_campaigns` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `conversation_id` text NOT NULL REFERENCES `project_correspondence`(`id`),
  `message_id` text NOT NULL REFERENCES `correspondence_messages`(`id`),
  `sender_user_id` text NOT NULL REFERENCES `users`(`id`),
  `request_hash` text NOT NULL,
  `reply_thread_id` text NOT NULL REFERENCES `email_reply_threads`(`id`),
  `status` text NOT NULL,
  `provider` text,
  `provider_message_id` text,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_email_campaign_message_unique` ON `project_email_campaigns` (`message_id`);
--> statement-breakpoint
CREATE INDEX `project_email_campaign_project_idx` ON `project_email_campaigns` (`organization_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `project_email_recipients` (
  `id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL REFERENCES `project_email_campaigns`(`id`),
  `email` text NOT NULL,
  `kind` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_email_recipient_unique` ON `project_email_recipients` (`campaign_id`,`email`);
--> statement-breakpoint
CREATE INDEX `project_email_recipient_email_idx` ON `project_email_recipients` (`email`);
