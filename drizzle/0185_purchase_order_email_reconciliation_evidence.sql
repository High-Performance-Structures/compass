ALTER TABLE `project_operations` ADD `purchase_order_email_reconciliation_outcome` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD `purchase_order_email_reconciled_at` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD `purchase_order_email_reconciled_by_user_id` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD `purchase_order_email_reconciliation_evidence` text;
