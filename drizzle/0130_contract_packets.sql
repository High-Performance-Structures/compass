CREATE TABLE `contract_document_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `category` text DEFAULT 'exhibit' NOT NULL,
  `signing_stage` text DEFAULT 'contract' NOT NULL,
  `default_inclusion_mode` text DEFAULT 'embedded' NOT NULL,
  `department_codes_json` text DEFAULT '[]' NOT NULL,
  `source_workbook_id` text,
  `source_sheet_names_json` text,
  `source_url` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_document_templates_org_code_uq` ON `contract_document_templates` (`organization_id`,`code`);
--> statement-breakpoint
CREATE INDEX `contract_document_templates_org_order_idx` ON `contract_document_templates` (`organization_id`,`active`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `contract_document_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `content_markdown` text NOT NULL,
  `source_fingerprint` text,
  `source_captured_at` text,
  `drive_document_id` text,
  `drive_document_url` text,
  `change_note` text,
  `created_by` text,
  `published_by` text,
  `published_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`template_id`) REFERENCES `contract_document_templates`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_document_template_versions_number_uq` ON `contract_document_template_versions` (`template_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `contract_document_template_versions_status_idx` ON `contract_document_template_versions` (`template_id`,`status`,`version_number`);
--> statement-breakpoint
CREATE TABLE `contract_packets` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `packet_number` text NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `title` text DEFAULT 'Construction Contract' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `legal_entity_name` text NOT NULL,
  `contract_draft_date` text,
  `approximate_commencement_date` text,
  `approximate_completion_date` text,
  `deposit_cents` integer DEFAULT 0 NOT NULL,
  `late_payment_rate_basis_points` integer DEFAULT 1200 NOT NULL,
  `details_json` text DEFAULT '{}' NOT NULL,
  `client_signers_json` text DEFAULT '[]' NOT NULL,
  `company_signer_name` text,
  `company_signer_title` text,
  `company_signer_email` text,
  `company_signer_initials` text,
  `foxit_status` text DEFAULT 'not_started' NOT NULL,
  `foxit_envelope_id` text,
  `foxit_embedded_session_url` text,
  `prepared_source_hash` text,
  `prepared_at` text,
  `signature_requested_at` text,
  `signature_package_url` text,
  `signed_at` text,
  `acceptance_method` text,
  `acceptance_evidence_label` text,
  `acceptance_recorded_by_name` text,
  `accepted_at` text,
  `accepted_by` text,
  `source_hash` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_packets_project_number_version_uq` ON `contract_packets` (`project_id`,`packet_number`,`version_number`);
--> statement-breakpoint
CREATE INDEX `contract_packets_project_status_idx` ON `contract_packets` (`project_id`,`status`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_packets_foxit_envelope_uq` ON `contract_packets` (`foxit_envelope_id`);
--> statement-breakpoint
CREATE TABLE `contract_packet_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `packet_id` text NOT NULL,
  `template_id` text,
  `template_version_id` text,
  `code` text NOT NULL,
  `title` text NOT NULL,
  `content_markdown` text DEFAULT '' NOT NULL,
  `inclusion_mode` text DEFAULT 'embedded' NOT NULL,
  `signing_stage` text DEFAULT 'contract' NOT NULL,
  `signature_policy` text DEFAULT 'all_signers' NOT NULL,
  `document_date` text,
  `revision` text,
  `source_url` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`packet_id`) REFERENCES `contract_packets`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`template_id`) REFERENCES `contract_document_templates`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`template_version_id`) REFERENCES `contract_document_template_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contract_packet_documents_packet_order_idx` ON `contract_packet_documents` (`packet_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `contract_packet_documents_project_idx` ON `contract_packet_documents` (`project_id`,`packet_id`);
