-- Trade docs kept on each vendor (W-9, insurance certificates, license,
-- signed trade agreement, info sheet). The files live in Google Drive; these
-- rows record what was received, when it expires, and who checked it. A newer
-- document of the same type supersedes the older one instead of deleting it.
CREATE TABLE `vendor_trade_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `vendor_id` text NOT NULL REFERENCES `vendors`(`id`) ON DELETE cascade,
  `doc_type` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'document',
  `drive_file_id` text,
  `file_name` text,
  `web_url` text,
  `effective_on` text,
  `expires_on` text,
  `checks_json` text,
  `notes` text,
  `source` text NOT NULL DEFAULT 'upload',
  `superseded_at` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_by_name` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_trade_documents_vendor_idx` ON `vendor_trade_documents` (`vendor_id`, `doc_type`, `superseded_at`);
--> statement-breakpoint
CREATE INDEX `vendor_trade_documents_org_expiry_idx` ON `vendor_trade_documents` (`organization_id`, `expires_on`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_trade_documents_drive_file_uq` ON `vendor_trade_documents` (`vendor_id`, `drive_file_id`) WHERE `drive_file_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `trade_docs_folder_id` text;
--> statement-breakpoint
ALTER TABLE `vendors` ADD `trade_docs_bill_mode` text;
