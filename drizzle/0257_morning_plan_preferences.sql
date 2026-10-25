-- Today's plan: each staff member's daily digest choice (off by default) and
-- what was last sent, so the digest goes at most once a day and an overload
-- warning at most once a week.
CREATE TABLE `morning_plan_preferences` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
	`digest_enabled` integer NOT NULL DEFAULT 0,
	`digest_hour` integer NOT NULL DEFAULT 7,
	`last_digest_on` text,
	`last_overload_week` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_morning_plan_preferences_org` ON `morning_plan_preferences` (`organization_id`);
