CREATE TABLE `message_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`mention_type` text NOT NULL,
	`target_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
