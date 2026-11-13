-- Selection replacements (2026-11-12). Additive only.
-- An approved, ordered or installed selection doesn't change in place. When
-- an installed item must be replaced, the owner changes their mind after it
-- was approved or purchased, or the supplier couldn't fill the order, staff
-- make a NEW selection that replaces it (and a to-do to write the change
-- order): the old one stays on record as it was, and the new one points back
-- to it. One replacement per selection (unique). replacement_reason:
-- 'installed_replaced', 'owner_changed_after_approval',
-- 'owner_changed_after_purchase' or 'supplier_couldnt_fill'
-- (src/lib/domain/selections/statuses.ts).
ALTER TABLE `project_finish_selections` ADD `replaces_selection_id` text REFERENCES `project_finish_selections`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project_finish_selections` ADD `replacement_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_finish_selections_replaces_unique` ON `project_finish_selections` (`replaces_selection_id`);--> statement-breakpoint
-- Set when staff mark an ordered selection Unavailable (the supplier can't
-- fill it): purchase orders linked before this no longer move it.
ALTER TABLE `project_finish_selections` ADD `procurement_released_at` text;
