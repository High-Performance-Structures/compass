-- Nu-Tech orders: the delivery shipping charge (quoted per order, not
-- taxable) and the sales tax district the order is taxed in (where the block
-- is delivered, or the pickup warehouse's district).
ALTER TABLE `nutech_order_workflows` ADD `shipping_cents` integer;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `shipping_note` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `tax_entity_id` text;
