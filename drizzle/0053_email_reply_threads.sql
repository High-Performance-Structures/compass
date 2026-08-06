CREATE TABLE `email_reply_threads` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `channel_id` text,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `source_number` text,
  `reply_to_address` text NOT NULL,
  `subject` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_by` text,
  `last_inbound_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_reply_threads_token_idx` ON `email_reply_threads` (`token`);
--> statement-breakpoint
CREATE INDEX `email_reply_threads_org_project_idx` ON `email_reply_threads` (`organization_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `email_reply_threads_source_idx` ON `email_reply_threads` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE TABLE `inbound_emails` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_id` text,
  `reply_thread_id` text,
  `token` text,
  `gmail_message_id` text NOT NULL,
  `gmail_thread_id` text,
  `message_id_header` text,
  `in_reply_to_header` text,
  `references_header` text,
  `from_address` text NOT NULL,
  `from_name` text,
  `to_address` text,
  `subject` text NOT NULL,
  `text_body` text,
  `html_body` text,
  `snippet` text,
  `matched_status` text DEFAULT 'needs_review' NOT NULL,
  `posted_message_id` text,
  `received_at` text NOT NULL,
  `imported_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`reply_thread_id`) REFERENCES `email_reply_threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_gmail_message_id_idx` ON `inbound_emails` (`gmail_message_id`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_org_project_idx` ON `inbound_emails` (`organization_id`,`project_id`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_reply_thread_idx` ON `inbound_emails` (`reply_thread_id`);
--> statement-breakpoint
CREATE INDEX `inbound_emails_status_idx` ON `inbound_emails` (`matched_status`);
