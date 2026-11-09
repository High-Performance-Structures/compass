-- Selections foundations: choices as rows under a selection, supplier product
-- links with a preview card, photo links, comments (owner-visible or staff-only),
-- and follow-up selections a choice opens. Additive only: five new tables, no
-- changes to existing rows. The last two statements copy today's flat
-- choice_options_json lists and parent_choice_value links into the new rows;
-- they only INSERT, use fixed ids and OR IGNORE, so a re-run adds nothing.
CREATE TABLE IF NOT EXISTS `project_selection_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`price_cents` integer,
	`lead_time_days` integer,
	`vendor_id` text,
	`supplier_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`chosen` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`bt_choice_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_selection_idx` ON `project_selection_choices` (`selection_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_project_idx` ON `project_selection_choices` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_vendor_id_idx` ON `project_selection_choices` (`vendor_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_created_by_idx` ON `project_selection_choices` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_selection_choices_one_chosen` ON `project_selection_choices` (`selection_id`) WHERE "chosen" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_selection_choices_bt_unique` ON `project_selection_choices` (`source_system`,`bt_choice_id`) WHERE "bt_choice_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_selection_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`choice_id` text,
	`url` text NOT NULL,
	`title` text,
	`image_url` text,
	`price_cents` integer,
	`site_name` text,
	`fetched_at` text,
	`added_by_user_id` text,
	`added_by_audience` text DEFAULT 'staff' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`choice_id`) REFERENCES `project_selection_choices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_links_selection_idx` ON `project_selection_links` (`selection_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_links_project_idx` ON `project_selection_links` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_links_choice_id_idx` ON `project_selection_links` (`choice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_links_added_by_user_id_idx` ON `project_selection_links` (`added_by_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_selection_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`choice_id` text,
	`photo_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`added_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`choice_id`) REFERENCES `project_selection_choices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`) REFERENCES `daily_log_photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_selection_photos_unique` ON `project_selection_photos` (`selection_id`,`photo_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_photos_project_idx` ON `project_selection_photos` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_photos_choice_id_idx` ON `project_selection_photos` (`choice_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_photos_photo_id_idx` ON `project_selection_photos` (`photo_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_photos_added_by_idx` ON `project_selection_photos` (`added_by`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_selection_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'staff' NOT NULL,
	`author_user_id` text,
	`author_audience` text DEFAULT 'staff' NOT NULL,
	`author_name_snapshot` text,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`bt_comment_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_comments_selection_idx` ON `project_selection_comments` (`selection_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_comments_project_idx` ON `project_selection_comments` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_comments_author_user_id_idx` ON `project_selection_comments` (`author_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_selection_comments_bt_unique` ON `project_selection_comments` (`source_system`,`bt_comment_id`) WHERE "bt_comment_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_selection_choice_dependents` (
	`choice_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`choice_id`, `selection_id`),
	FOREIGN KEY (`choice_id`) REFERENCES `project_selection_choices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selection_id`) REFERENCES `project_finish_selections`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choice_dependents_selection_idx` ON `project_selection_choice_dependents` (`selection_id`);--> statement-breakpoint
-- Backfill: one choice row per text option in choice_options_json, in list order.
-- The option matching the selection's color/finish (first match) is marked chosen.
INSERT OR IGNORE INTO `project_selection_choices` (
	`id`, `project_id`, `selection_id`, `title`, `sort_order`, `chosen`, `status`,
	`source_system`, `created_at`, `updated_at`
)
SELECT
	'psc_' || s.`id` || '_' || o.`key`,
	s.`project_id`,
	s.`id`,
	trim(o.`value`),
	o.`key`,
	CASE WHEN o.`key` = (
		SELECT min(m.`key`) FROM json_each(s.`choice_options_json`) m
		WHERE m.`type` = 'text' AND trim(m.`value`) <> '' AND trim(m.`value`) = trim(coalesce(s.`color_finish`, ''))
	) THEN 1 ELSE 0 END,
	'available',
	s.`source_system`,
	s.`created_at`,
	s.`updated_at`
FROM `project_finish_selections` s, json_each(s.`choice_options_json`) o
WHERE s.`choice_options_json` IS NOT NULL
	AND json_valid(s.`choice_options_json`)
	AND json_type(s.`choice_options_json`) = 'array'
	AND o.`type` = 'text'
	AND trim(o.`value`) <> '';--> statement-breakpoint
-- Backfill: a child selection whose parent_choice_value names one of its parent's
-- choices becomes a dependent of that choice (first matching title).
INSERT OR IGNORE INTO `project_selection_choice_dependents` (`choice_id`, `selection_id`, `created_at`)
SELECT
	(SELECT c.`id` FROM `project_selection_choices` c
		WHERE c.`selection_id` = child.`parent_selection_id` AND c.`title` = trim(child.`parent_choice_value`)
		ORDER BY c.`sort_order` LIMIT 1),
	child.`id`,
	child.`created_at`
FROM `project_finish_selections` child
WHERE child.`parent_selection_id` IS NOT NULL
	AND child.`parent_choice_value` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `project_selection_choices` c
		WHERE c.`selection_id` = child.`parent_selection_id` AND c.`title` = trim(child.`parent_choice_value`)
	);
