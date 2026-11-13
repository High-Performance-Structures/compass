-- Selection replacements (2026-11-12). Additive only.
-- An ordered or installed selection is locked. When an installed item must be
-- replaced with a different product, or the owner changes their mind after it
-- was purchased, staff make a NEW selection that replaces it: the old one stays
-- on record as it was, and the new one points back to it. One replacement per
-- selection (unique). replacement_reason: 'installed_replaced' or
-- 'owner_changed_after_purchase' (src/lib/domain/selections/statuses.ts).
ALTER TABLE `project_finish_selections` ADD `replaces_selection_id` text REFERENCES `project_finish_selections`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `replacement_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_finish_selections_replaces_unique` ON `project_finish_selections` (`replaces_selection_id`);--> statement-breakpoint
-- One live (not void or declined) change order per selection replacement, so a
-- double submit of "Create change order" can't make two.
CREATE UNIQUE INDEX IF NOT EXISTS `project_change_orders_one_live_replacement` ON `project_change_orders` (`source_record_id`) WHERE `source_type` = 'selection_replacement' AND `status` NOT IN ('void', 'declined');
