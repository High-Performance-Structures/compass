ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_token` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_revision` integer;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_status` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_attempt` integer;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_provider_message_id` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_error` text;
