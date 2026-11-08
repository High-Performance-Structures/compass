-- Other email addresses for staff (not for sign-in): recognize the person on
-- imported messages and offer the address as a send-to choice. Additive only.
CREATE TABLE IF NOT EXISTS `user_alternate_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`email` text NOT NULL,
	`created_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null,
	`created_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_alternate_emails_org_email_unique` ON `user_alternate_emails` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_alternate_emails_user_idx` ON `user_alternate_emails` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_alternate_emails_created_by_idx` ON `user_alternate_emails` (`created_by_user_id`);
