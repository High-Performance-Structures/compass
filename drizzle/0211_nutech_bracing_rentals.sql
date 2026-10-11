-- Nu-Tech bracing rentals: what went out to a job, what came back, damage,
-- deposit and the days billed. Replaces the paper rental form and the
-- office whiteboard; equipment, sizes and rates are company settings.
CREATE TABLE `nutech_bracing_rentals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`signed_out_on` text,
	`expected_return_on` text,
	`returned_on` text,
	`billed_days` integer,
	`daily_rate_cents` integer NOT NULL,
	`deposit_cents` integer DEFAULT 0 NOT NULL,
	`id_copy_received` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `nutech_bracing_rentals_project_idx` ON `nutech_bracing_rentals` (`project_id`);
--> statement-breakpoint
CREATE INDEX `nutech_bracing_rentals_org_status_idx` ON `nutech_bracing_rentals` (`organization_id`, `status`);
--> statement-breakpoint
CREATE TABLE `nutech_bracing_rental_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`rental_id` text NOT NULL,
	`item_key` text NOT NULL,
	`item_label` text NOT NULL,
	`size` text DEFAULT '' NOT NULL,
	`quantity_out` integer DEFAULT 0 NOT NULL,
	`quantity_returned` integer DEFAULT 0 NOT NULL,
	`quantity_damaged` integer DEFAULT 0 NOT NULL,
	`damage_cents` integer DEFAULT 0 NOT NULL,
	`damage_note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`rental_id`) REFERENCES `nutech_bracing_rentals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nutech_bracing_rental_lines_rental_idx` ON `nutech_bracing_rental_lines` (`rental_id`, `sort_order`);
