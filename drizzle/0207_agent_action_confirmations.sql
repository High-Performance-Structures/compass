-- Ask Jarvis confirmations: one row per Confirm click on a held action
-- (schedule changes, dashboard deletion). The token id is the primary key,
-- so a confirmation can be carried out only once even if it is replayed
-- within its ten-minute lifetime.
CREATE TABLE `agent_action_confirmations` (
	`token_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`path` text NOT NULL,
	`action` text NOT NULL,
	`confirmed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_action_confirmations_user_idx` ON `agent_action_confirmations` (`user_id`, `confirmed_at`);
