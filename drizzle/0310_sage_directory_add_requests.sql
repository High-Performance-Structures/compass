-- Office staff ask for a vendor, client, or one of their people to be added to
-- Sage; Compass checks for duplicates and the company's approver decides.
-- Additive only.
CREATE TABLE IF NOT EXISTS `sage_directory_add_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`parent_request_id` text REFERENCES `sage_directory_add_requests`(`id`) ON DELETE set null,
	`fields_json` text NOT NULL,
	`vendor_type` text,
	`form_1099` text,
	`duplicates_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`requested_at` text NOT NULL,
	`reviewed_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`reviewed_at` text,
	`review_note` text,
	`write_operation_id` text,
	`sage_record_id` text,
	`sage_record_number` text,
	`error_message` text,
	`completed_at` text,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sage_directory_add_requests_active_unique` ON `sage_directory_add_requests` (`organization_id`,`kind`,`entity_id`) WHERE `status` IN ('pending', 'approved', 'sent');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_directory_add_requests_org_status_idx` ON `sage_directory_add_requests` (`organization_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_directory_add_requests_operation_idx` ON `sage_directory_add_requests` (`write_operation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_directory_add_requests_parent_request_id_idx` ON `sage_directory_add_requests` (`parent_request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_directory_add_requests_requested_by_user_id_idx` ON `sage_directory_add_requests` (`requested_by_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_directory_add_requests_reviewed_by_user_id_idx` ON `sage_directory_add_requests` (`reviewed_by_user_id`);--> statement-breakpoint
-- Whether the vendor gets a 1099: yes, no, or unknown until a W-9 comes in.
ALTER TABLE `vendors` ADD `form_1099_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
-- New vendors ride the client/job writer queue ("ensure_vendor").
ALTER TABLE `sage_client_project_write_operations` ADD `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `sage_client_project_write_operations` ADD `sage_vendor_id` text;--> statement-breakpoint
ALTER TABLE `sage_client_project_write_operations` ADD `sage_vendor_number` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sage_client_project_write_operations_vendor_id_idx` ON `sage_client_project_write_operations` (`vendor_id`);--> statement-breakpoint
-- A new Sage person who already exists in Compass is linked, not copied.
ALTER TABLE `sage_contact_create_proposals` ADD `compass_person_id` text;
