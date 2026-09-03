CREATE TABLE `project_rfq_bid_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `rfq_operation_id` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `response_snapshot_json` text NOT NULL,
  `responder_name` text NOT NULL,
  `responder_company` text,
  `response_submitted_at` text NOT NULL,
  `approval_note` text,
  `approved_by` text,
  `approved_by_name` text NOT NULL,
  `approved_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`rfq_operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_rfq_bid_approvals_rfq_uq` ON `project_rfq_bid_approvals` (`rfq_operation_id`);
CREATE INDEX `project_rfq_bid_approvals_project_idx` ON `project_rfq_bid_approvals` (`project_id`, `approved_at`);

CREATE TABLE `project_estimate_rfq_bid_imports` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `approval_id` text NOT NULL,
  `estimate_id` text NOT NULL,
  `imported_amount_cents` integer NOT NULL,
  `imported_by` text,
  `imported_by_name` text NOT NULL,
  `imported_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`approval_id`) REFERENCES `project_rfq_bid_approvals`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`estimate_id`) REFERENCES `project_estimates`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_estimate_rfq_bid_imports_approval_uq` ON `project_estimate_rfq_bid_imports` (`approval_id`);
CREATE INDEX `project_estimate_rfq_bid_imports_estimate_idx` ON `project_estimate_rfq_bid_imports` (`estimate_id`, `imported_at`);

CREATE TABLE `project_estimate_rfq_bid_import_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `import_id` text NOT NULL,
  `estimate_line_id` text,
  `rfq_line_number` integer NOT NULL,
  `description_snapshot` text NOT NULL,
  `cost_code_snapshot` text,
  `amount_cents` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`import_id`) REFERENCES `project_estimate_rfq_bid_imports`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`estimate_line_id`) REFERENCES `project_estimate_lines`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `project_estimate_rfq_bid_import_lines_estimate_line_uq` ON `project_estimate_rfq_bid_import_lines` (`estimate_line_id`);
CREATE INDEX `project_estimate_rfq_bid_import_lines_import_idx` ON `project_estimate_rfq_bid_import_lines` (`import_id`, `rfq_line_number`);
