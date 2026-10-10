ALTER TABLE `staff_message_records`
  ADD `status` text DEFAULT 'new' NOT NULL
  CHECK (`status` IN ('new', 'follow_up_needed', 'in_progress', 'waiting_on_contact', 'closed'));
--> statement-breakpoint
CREATE INDEX `staff_message_records_org_status_updated_idx`
  ON `staff_message_records` (`organization_id`, `status`, `updated_at`);
