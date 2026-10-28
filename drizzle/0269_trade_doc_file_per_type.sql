-- One insurance certificate file can hold two documents (general liability
-- and workers' comp), so a Drive file is unique per vendor and document type.
DROP INDEX IF EXISTS `vendor_trade_documents_drive_file_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_trade_documents_drive_file_uq` ON `vendor_trade_documents` (`vendor_id`, `doc_type`, `drive_file_id`) WHERE `drive_file_id` IS NOT NULL;
