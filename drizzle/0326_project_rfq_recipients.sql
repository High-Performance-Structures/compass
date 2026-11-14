-- RFQ recipients (approved 2026-11-13, issue #1329). Additive only: a new
-- table, no existing rows change.
-- One row per vendor company that received an RFQ and answered it, with that
-- vendor's own answer. The RFQ itself stays one project_operations row (one
-- per bid package for Buildertrend imports). The vendor portal shows an RFQ to
-- a signed-in vendor whose company is a recipient, with only that vendor's own
-- answer: other recipients' prices are never read for a vendor.
-- response_status: 'quoted' | 'declined'.
-- quote_amount_cents: the vendor's total, NULL when declined or when the quote
--   carried no amount (Buildertrend "$0.00" submissions with a PDF only).
-- entered_by_builder: 1 when staff recorded the vendor's quote for them.
-- source_system / source_record_id: where the answer came from (for
--   Buildertrend, the BT bid id); unique per RFQ so a re-run adds nothing.
-- vendor_id: the vendor at import time. A later duplicate merge is followed at
--   read time (vendors.merged_into_vendor_id), so no rewrite is needed.
CREATE TABLE IF NOT EXISTS `project_rfq_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
	`rfq_operation_id` text NOT NULL REFERENCES `project_operations`(`id`) ON DELETE cascade,
	`vendor_id` text NOT NULL REFERENCES `vendors`(`id`) ON DELETE cascade,
	`response_status` text NOT NULL,
	`quote_amount_cents` integer,
	`responded_at` text,
	`entered_by_builder` integer DEFAULT false NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_rfq_recipients_source_uq` ON `project_rfq_recipients` (`rfq_operation_id`,`source_system`,`source_record_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_rfq_recipients_project_vendor_idx` ON `project_rfq_recipients` (`project_id`,`vendor_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_rfq_recipients_vendor_idx` ON `project_rfq_recipients` (`vendor_id`);
