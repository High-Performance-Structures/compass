CREATE TABLE `user_provider_config` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider_type` text NOT NULL,
	`api_key` text,
	`base_url` text,
	`model_overrides` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
