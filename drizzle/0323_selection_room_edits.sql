-- Finish selection room edits (2026-11-13). Additive only.
-- staff_edited_at: staff renamed, retyped or reordered the room in Compass.
-- A workbook re-import then keeps the room's name, type and order.
-- deleted_at: staff deleted a workbook room in Compass. A re-import leaves it
-- out (and skips its rows) unless staff choose to bring deleted rooms back.
ALTER TABLE `project_finish_selection_rooms` ADD `staff_edited_at` text;--> statement-breakpoint
ALTER TABLE `project_finish_selection_rooms` ADD `deleted_at` text;
