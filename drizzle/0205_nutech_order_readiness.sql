-- Customer readiness before a Nu-Tech order is placed with the manufacturer:
-- payment, and for customer pickup the trailer details the manufacturer requires.
ALTER TABLE `nutech_order_workflows` ADD `customer_paid_at` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `customer_payment_method` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `trailer_dimensions` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD `trailer_photo_received_at` text;
