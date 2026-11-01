-- Keeps Sage's vendor certificates (expiry, Warning, Stop Pay) in step with
-- each vendor's trade docs in Compass: one sync row per vendor.
CREATE TABLE `sage_vendor_certificate_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_at` text NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`result_json` text,
	`error_message` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_vendor_certificate_syncs_vendor_idx` ON `sage_vendor_certificate_syncs` (`vendor_id`);
--> statement-breakpoint
CREATE INDEX `sage_vendor_certificate_syncs_org_status_idx` ON `sage_vendor_certificate_syncs` (`organization_id`,`status`);
--> statement-breakpoint
-- Read-only Sage vendor catalog, for linking Compass vendors to Sage in bulk.
CREATE TABLE `sage_vendor_directory_entries` (
	`organization_id` text NOT NULL,
	`sage_record_id` text NOT NULL,
	`sage_vendor_number` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_vendor_directory_org_id_unique` ON `sage_vendor_directory_entries` (`organization_id`,`sage_record_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_vendor_directory_org_number_unique` ON `sage_vendor_directory_entries` (`organization_id`,`sage_vendor_number`);
--> statement-breakpoint
CREATE INDEX `sage_vendor_directory_org_name_idx` ON `sage_vendor_directory_entries` (`organization_id`,`name`);
