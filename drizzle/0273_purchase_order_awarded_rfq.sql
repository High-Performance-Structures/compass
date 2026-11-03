-- A supplier PO can be drawn against an accepted quote (the RFQ it answered),
-- so the estimate's Selected trades can total what's been ordered.
ALTER TABLE `project_operations` ADD `awarded_rfq_id` text;
--> statement-breakpoint
CREATE INDEX `project_operations_awarded_rfq_idx` ON `project_operations` (`awarded_rfq_id`) WHERE `awarded_rfq_id` IS NOT NULL;
