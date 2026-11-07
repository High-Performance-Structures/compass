-- Variances alongside change orders: a change-order row is a change order or
-- a variance; variance lines may carry Compass-added builder fee and
-- insurance lines; each project records its owner contract type.
-- Additive only.
ALTER TABLE `project_change_orders` ADD `record_type` text DEFAULT 'change_order' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_change_orders` ADD `former_change_order_number` text;--> statement-breakpoint
ALTER TABLE `project_change_order_lines` ADD `derived_from` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `contract_type` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_change_orders_record_type_idx` ON `project_change_orders` (`project_id`,`record_type`,`status`);
