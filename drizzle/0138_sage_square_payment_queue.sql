CREATE TABLE `sage_square_webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`square_object_id` text,
	`square_created_at` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`error_message` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_square_webhook_events_status_idx` ON `sage_square_webhook_events` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `sage_square_payment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`square_payment_id` text NOT NULL,
	`square_invoice_id` text NOT NULL,
	`square_order_id` text NOT NULL,
	`square_location_id` text NOT NULL,
	`department` text NOT NULL,
	`sage_invoice_id` text NOT NULL,
	`sage_invoice_number` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`deposit_account_number` integer NOT NULL,
	`merchant_fee_account_number` integer NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`claim_token` text,
	`claimed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`sage_record_id` text,
	`sage_record_number` text,
	`error_message` text,
	`payment_completed_at` text NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_square_payment_operations_idempotency_idx` ON `sage_square_payment_operations` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `sage_square_payment_operations_claim_idx` ON `sage_square_payment_operations` (`status`,`claimed_at`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_square_payment_operations_payment_idx` ON `sage_square_payment_operations` (`square_payment_id`,`operation_type`);
--> statement-breakpoint
CREATE INDEX `sage_square_payment_operations_invoice_idx` ON `sage_square_payment_operations` (`square_invoice_id`,`status`);
