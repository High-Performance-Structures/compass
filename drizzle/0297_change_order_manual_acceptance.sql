-- Manual acceptance for change orders: staff record an owner's written
-- approval (evidence saved as the executed document) or a staff sign-off for
-- a verbal approval. Additive only: new nullable columns and indexes, no data
-- changes, no table rebuilds.

-- How the acceptance was recorded: written_approval, staff_signoff, or
-- owner_workspace (the owner accepts in their own workspace).
ALTER TABLE `project_change_orders` ADD COLUMN `acceptance_method` text;
--> statement-breakpoint
-- The owner contact who approved, when chosen from the project contacts.
ALTER TABLE `project_change_orders` ADD COLUMN `accepted_by_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- snapshot: the approver's name as recorded when the acceptance was recorded.
ALTER TABLE `project_change_orders` ADD COLUMN `accepted_by_name_snapshot` text;
--> statement-breakpoint
-- The date (YYYY-MM-DD) the owner approved.
ALTER TABLE `project_change_orders` ADD COLUMN `accepted_on` text;
--> statement-breakpoint
-- The staff member who recorded the acceptance.
ALTER TABLE `project_change_orders` ADD COLUMN `acceptance_recorded_by` text REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `project_change_orders` ADD COLUMN `acceptance_note` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_change_orders_accepted_by_contact_idx`
  ON `project_change_orders` (`accepted_by_contact_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_change_orders_acceptance_recorded_by_idx`
  ON `project_change_orders` (`acceptance_recorded_by`);
