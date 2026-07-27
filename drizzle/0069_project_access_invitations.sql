CREATE TABLE `project_access_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_contact_id` text,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`workos_invitation_id` text,
	`workos_expires_at` text,
	`email_provider` text,
	`email_provider_message_id` text,
	`email_error` text,
	`invited_by` text NOT NULL,
	`invited_at` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_contact_id`) REFERENCES `project_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_access_invites_project` ON `project_access_invitations` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_access_invites_email` ON `project_access_invitations` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_project_access_invites_status` ON `project_access_invitations` (`status`);
