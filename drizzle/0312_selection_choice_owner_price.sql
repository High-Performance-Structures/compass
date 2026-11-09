-- What the owner sees for a selection choice (supplier price plus builder fee),
-- set by staff. Null: not priced for the owner yet. Additive only.
ALTER TABLE `project_selection_choices` ADD `owner_price_cents` integer;
