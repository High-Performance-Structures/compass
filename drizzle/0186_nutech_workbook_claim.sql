ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_token` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_revision` integer;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_attempt` integer;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_reclaim_after` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_retry_until` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `nutech_order_workflows` ADD COLUMN `airlite_workbook_claim_error` text;
