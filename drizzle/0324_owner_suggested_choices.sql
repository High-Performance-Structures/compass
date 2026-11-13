-- Owner-suggested choices (approved 2026-11-13). Additive only.
-- An owner can add their own choice to a published selection ("Add my own
-- choice"). It is marked as the owner's suggestion and waits for staff to
-- set the owner price (with markup) the normal way: a product page's price
-- is only the supplier price, never the owner or contract price.
-- suggested_by_user_id: the owner who suggested it (NULL for staff-made
-- choices, or once that user is deleted; suggested_at keeps the marker).
-- owner_pricing_pending: 1 until staff set the owner price; a Selection
-- Phase can't go out for signature while a picked choice is pending.
-- owner_priced_at: when staff priced the suggestion (cleared "pending").
ALTER TABLE `project_selection_choices` ADD `suggested_by_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `suggested_at` text;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `owner_pricing_pending` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_selection_choices` ADD `owner_priced_at` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_selection_choices_suggested_by_user_id_idx` ON `project_selection_choices` (`suggested_by_user_id`);
