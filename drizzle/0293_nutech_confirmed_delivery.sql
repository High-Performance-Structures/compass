-- The manufacturer's confirmed pickup or delivery for a Nu-Tech order, which
-- often differs from the customer's requested date: the date, a free-text
-- time or dock window ("dock time 2:00 PM"), and the carrier.
-- Additive only: nullable columns.
ALTER TABLE `nutech_order_workflows` ADD COLUMN `confirmed_delivery_date` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `confirmed_delivery_time` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `carrier` text;
