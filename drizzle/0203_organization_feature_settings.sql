CREATE TABLE `organization_feature_settings` (
	`organization_id` text NOT NULL,
	`feature_key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`organization_id`, `feature_key`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
