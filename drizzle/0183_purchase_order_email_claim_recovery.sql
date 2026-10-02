ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_reclaim_after` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_retry_until` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_provider_payload` text;
--> statement-breakpoint
ALTER TABLE `project_operations` ADD COLUMN `purchase_order_email_claim_provider_credential_fingerprint` text;
--> statement-breakpoint
UPDATE `project_operations`
SET
  `purchase_order_email_claim_status` = 'uncertain',
  `purchase_order_email_claim_error` = COALESCE(
    `purchase_order_email_claim_error`,
    'Legacy email claim requires delivery reconciliation before retry.'
  ),
  `purchase_order_email_claim_reclaim_after` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`, '+5 minutes'),
  `purchase_order_email_claim_retry_until` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`, '+23 hours')
WHERE `purchase_order_email_claim_status` IN ('in_flight', 'uncertain');