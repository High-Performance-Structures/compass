ALTER TABLE `projects` ADD `public_title` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `public_location_city` text;
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`department` text NOT NULL,
	`platform` text NOT NULL,
	`external_account_id` text NOT NULL,
	`parent_external_account_id` text,
	`account_name` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`token_expires_at` text,
	`granted_scopes` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`connected_by` text,
	`connected_at` text NOT NULL,
	`last_published_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_accounts_org_department_platform_unique` ON `social_accounts` (`organization_id`,`department`,`platform`);
--> statement-breakpoint
CREATE INDEX `social_accounts_org_status_idx` ON `social_accounts` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `social_connection_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`department` text NOT NULL,
	`candidates_encrypted` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_connection_drafts_user_expires_idx` ON `social_connection_drafts` (`user_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `social_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`department` text NOT NULL,
	`public_title_snapshot` text NOT NULL,
	`location_city_snapshot` text NOT NULL,
	`heading` text NOT NULL,
	`body` text NOT NULL,
	`hashtags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`published_at` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_posts_org_created_idx` ON `social_posts` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `social_posts_project_created_idx` ON `social_posts` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `social_posts_org_status_idx` ON `social_posts` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `social_post_media` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`alt_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `social_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_post_media_post_photo_unique` ON `social_post_media` (`post_id`,`photo_id`);
--> statement-breakpoint
CREATE TABLE `social_post_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`account_id` text NOT NULL,
	`platform` text NOT NULL,
	`facebook_album_mode` text DEFAULT 'none' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_post_id` text,
	`external_post_url` text,
	`error` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `social_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_post_targets_post_account_unique` ON `social_post_targets` (`post_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `social_post_targets_status_idx` ON `social_post_targets` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `social_project_albums` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`project_id` text NOT NULL,
	`external_album_id` text NOT NULL,
	`album_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_project_albums_account_project_unique` ON `social_project_albums` (`account_id`,`project_id`);
