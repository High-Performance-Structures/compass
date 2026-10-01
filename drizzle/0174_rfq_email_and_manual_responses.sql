CREATE TABLE `project_rfq_email_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `rfq_operation_id` text NOT NULL REFERENCES `project_operations`(`id`) ON DELETE restrict,
  `recipient_email` text NOT NULL,
  `cc_emails_json` text NOT NULL,
  `subject` text NOT NULL,
  `document_links_json` text NOT NULL,
  `status` text NOT NULL,
  `provider` text,
  `provider_message_id` text,
  `error` text,
  `requested_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `requested_by_name` text NOT NULL,
  `requested_at` text NOT NULL,
  `sent_at` text
);
--> statement-breakpoint
CREATE INDEX `project_rfq_email_deliveries_rfq_idx` ON `project_rfq_email_deliveries` (`rfq_operation_id`, `requested_at`);
--> statement-breakpoint
CREATE TABLE `project_rfq_manual_response_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `rfq_operation_id` text NOT NULL REFERENCES `project_operations`(`id`) ON DELETE restrict,
  `received_via` text NOT NULL,
  `source_reference` text,
  `previous_response_json` text,
  `response_json` text NOT NULL,
  `recorded_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `recorded_by_name` text NOT NULL,
  `recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_rfq_manual_response_events_rfq_idx` ON `project_rfq_manual_response_events` (`rfq_operation_id`, `recorded_at`);
