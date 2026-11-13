-- Selection replacements (2026-11-12). Additive only.
-- An ordered or installed selection is locked. When an installed item must be
-- replaced with a different product, or the owner changes their mind after it
-- was purchased, staff make a NEW selection that replaces it: the old one stays
-- on record as it was, and the new one points back to it. One replacement per
-- selection (unique). replacement_reason: 'installed_replaced',
-- 'owner_changed_after_purchase' or 'supplier_couldnt_fill'
-- (src/lib/domain/selections/statuses.ts).
ALTER TABLE `project_finish_selections` ADD `replaces_selection_id` text REFERENCES `project_finish_selections`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `replacement_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_finish_selections_replaces_unique` ON `project_finish_selections` (`replaces_selection_id`);--> statement-breakpoint
-- The choice a replacement's change order is priced for. The replacement
-- counts as signed only while its pick is this choice; a new pick re-prices
-- a draft change order and can't change once it is out or executed.
ALTER TABLE `project_finish_selections` ADD `replacement_priced_choice_id` text REFERENCES `project_selection_choices`(`id`) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_finish_selections_replacement_priced_choice_idx` ON `project_finish_selections` (`replacement_priced_choice_id`);--> statement-breakpoint
-- The line on the replacement's change order that prices its pick; re-priced in place.
ALTER TABLE `project_finish_selections` ADD `replacement_priced_line_id` text REFERENCES `project_change_order_lines`(`id`) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_finish_selections_replacement_priced_line_idx` ON `project_finish_selections` (`replacement_priced_line_id`);--> statement-breakpoint
-- The owner price already in the contract when an approved selection's pick
-- changes (the previous pick's): its Selection Phase line is priced as the
-- new owner price minus this, not minus the allowance again.
ALTER TABLE `project_finish_selections` ADD `settled_owner_price_cents` integer;--> statement-breakpoint
-- Set when staff mark an ordered selection Unavailable (the supplier can't
-- fill it): purchase orders linked before this no longer move it.
ALTER TABLE `project_finish_selections` ADD `procurement_released_at` text;--> statement-breakpoint
-- One live (not void or declined) change order per selection replacement, so a
-- double submit of "Create change order" can't make two.
CREATE UNIQUE INDEX IF NOT EXISTS `project_change_orders_one_live_replacement` ON `project_change_orders` (`source_record_id`) WHERE `source_type` = 'selection_replacement' AND `status` NOT IN ('void', 'declined');
