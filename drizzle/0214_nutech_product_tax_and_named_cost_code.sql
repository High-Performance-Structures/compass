-- Nu-Tech price-list items: whether the item is sales-taxable (freight is
-- not), and a named company cost code (e.g. "ICF Shipping") for items whose
-- Sage cost item isn't one of the numbered Sage cost codes.
ALTER TABLE `nutech_products` ADD `taxable` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `nutech_products` ADD `sage_cost_code_name` text;
