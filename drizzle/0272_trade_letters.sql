-- Letters of intent and award letters sent to selected trades for e-signature.
CREATE TABLE `trade_letters` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `estimate_id` text NOT NULL,
  `rfq_operation_id` text NOT NULL,
  `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null,
  `vendor_name` text NOT NULL,
  `kind` text NOT NULL,
  `letter_number` text NOT NULL,
  `status` text NOT NULL DEFAULT 'draft',
  `scope_json` text NOT NULL,
  `total_cents` integer NOT NULL,
  `quote_label` text NOT NULL,
  `owed_json` text NOT NULL DEFAULT '[]',
  `note` text,
  `includes_agreement` integer NOT NULL DEFAULT 0,
  `agreement_drive_file_id` text,
  `signer_name` text NOT NULL,
  `signer_email` text NOT NULL,
  `company_signer_name` text NOT NULL,
  `company_signer_email` text NOT NULL,
  `company_signer_title` text,
  `foxit_envelope_id` text,
  `foxit_embedded_session_url` text,
  `sent_at` text,
  `signed_at` text,
  `signed_drive_file_id` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_by_name` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trade_letters_estimate_idx` ON `trade_letters` (`project_id`, `estimate_id`, `rfq_operation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_letters_envelope_uq` ON `trade_letters` (`foxit_envelope_id`) WHERE `foxit_envelope_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_letters_number_uq` ON `trade_letters` (`organization_id`, `letter_number`);
