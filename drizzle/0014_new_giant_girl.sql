CREATE TABLE `user_model_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`prompt_cost` text NOT NULL,
	`completion_cost` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agent_config` ADD `max_cost_per_million` text;--> statement-breakpoint
ALTER TABLE `agent_config` ADD `allow_user_selection` integer DEFAULT 1 NOT NULL;