-- Round signing (approved by Martine 2026-11-09 10:46 as an additive migration).
-- Who made a choice's current pick, when, and the staff note (e.g. "per phone call").
ALTER TABLE `project_selection_choices` ADD `chosen_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `chosen_by_audience` text;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `chosen_at` text;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `chosen_note` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_chosen_by_user_id_idx` ON `project_selection_choices` (`chosen_by_user_id`);--> statement-breakpoint
-- One owner signature request for a selections round (Foxit e-sign), with the change order or variance it carries.
CREATE TABLE IF NOT EXISTS `project_selection_round_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`round_key` text NOT NULL,
	`round_name_snapshot` text NOT NULL,
	`status` text DEFAULT 'preparing' NOT NULL,
	`signers_json_snapshot` text NOT NULL,
	`allowance_cents` integer NOT NULL,
	`owner_total_cents` integer NOT NULL,
	`delta_cents` integer NOT NULL,
	`treatment` text DEFAULT 'none' NOT NULL,
	`change_order_id` text,
	`foxit_envelope_id` text,
	`foxit_embedded_session_url` text,
	`sent_at` text,
	`signed_at` text,
	`signed_drive_file_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`change_order_id`) REFERENCES `project_change_orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_round_signatures_round_idx` ON `project_selection_round_signatures` (`project_id`,`round_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_selection_round_signatures_envelope_unique` ON `project_selection_round_signatures` (`foxit_envelope_id`) WHERE "foxit_envelope_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_round_signatures_change_order_id_idx` ON `project_selection_round_signatures` (`change_order_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_round_signatures_created_by_idx` ON `project_selection_round_signatures` (`created_by`);--> statement-breakpoint
-- What one round signature covers: each selection with the pick and prices as signed.
CREATE TABLE IF NOT EXISTS `project_selection_round_signature_items` (
	`signature_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`choice_id` text,
	`choice_title_snapshot` text NOT NULL,
	`owner_price_cents_snapshot` integer,
	`allowance_cents_snapshot` integer,
	PRIMARY KEY(`signature_id`, `selection_id`),
	FOREIGN KEY (`signature_id`) REFERENCES `project_selection_round_signatures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`choice_id`) REFERENCES `project_selection_choices`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_round_signature_items_selection_idx` ON `project_selection_round_signature_items` (`selection_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_round_signature_items_choice_id_idx` ON `project_selection_round_signature_items` (`choice_id`);
