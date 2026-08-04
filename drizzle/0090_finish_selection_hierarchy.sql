ALTER TABLE `project_finish_selections` ADD `choice_options_json` text;
--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `parent_selection_id` text;
--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `parent_choice_value` text;
--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `selection_level` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_finish_selections_parent` ON `project_finish_selections` (`project_id`,`parent_selection_id`);
