CREATE TABLE `feedback_interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`user_role` text NOT NULL,
	`responses` text NOT NULL,
	`summary` text NOT NULL,
	`pain_points` text,
	`feature_requests` text,
	`overall_sentiment` text NOT NULL,
	`github_issue_url` text,
	`conversation_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
