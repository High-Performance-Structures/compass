ALTER TABLE `nutech_order_workflows`
  ADD COLUMN `airlite_workbook_provider_status` text NOT NULL DEFAULT 'not_started';
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows`
  ADD COLUMN `airlite_workbook_provider_attempted_at` text;
