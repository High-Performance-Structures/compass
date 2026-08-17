CREATE TABLE `staff_message_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `source_type` text NOT NULL CHECK (`source_type` IN ('call', 'message')),
  `goto_inbound_event_id` text REFERENCES `goto_inbound_events`(`id`) ON DELETE SET NULL,
  `caller_name` text NOT NULL,
  `caller_company` text,
  `caller_phone` text,
  `caller_email` text,
  `subject` text NOT NULL,
  `body` text NOT NULL,
  `assignee_user_id` text NOT NULL REFERENCES `users`(`id`),
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_message_records_goto_event_unique`
  ON `staff_message_records` (`goto_inbound_event_id`)
  WHERE `goto_inbound_event_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `staff_message_records_org_created_idx`
  ON `staff_message_records` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `staff_message_records_assignee_created_idx`
  ON `staff_message_records` (`assignee_user_id`, `created_at`);
