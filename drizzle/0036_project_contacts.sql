CREATE TABLE `project_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contact_type` text NOT NULL,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_record_id` text,
	`source_entity_type` text DEFAULT 'manual' NOT NULL,
	`source_entity_id` text,
	`display_name` text NOT NULL,
	`company_name` text,
	`role` text,
	`trade` text,
	`csi_division` text,
	`csi_division_name` text,
	`primary_cost_code` text,
	`email` text,
	`phone` text,
	`notes` text,
	`owner_portal_visible` integer DEFAULT false NOT NULL,
	`sub_vendor_portal_visible` integer DEFAULT false NOT NULL,
	`internal_visible` integer DEFAULT true NOT NULL,
	`primary_contact` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_contacts_project` ON `project_contacts` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_contacts_type` ON `project_contacts` (`project_id`,`contact_type`);
--> statement-breakpoint
CREATE INDEX `idx_project_contacts_csi` ON `project_contacts` (`project_id`,`csi_division`);
--> statement-breakpoint
CREATE INDEX `idx_project_contacts_source` ON `project_contacts` (`source_system`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_contacts_visibility` ON `project_contacts` (`project_id`,`owner_portal_visible`,`sub_vendor_portal_visible`,`internal_visible`);
