CREATE TABLE `project_contract_deposits` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `status` text DEFAULT 'received' NOT NULL,
  `requested_amount_cents` integer,
  `requested_at` text,
  `due_date` text,
  `received_amount_cents` integer,
  `received_at` text,
  `payment_method` text,
  `reference` text,
  `evidence_url` text,
  `evidence_label` text,
  `notes` text,
  `source_system` text DEFAULT 'compass' NOT NULL,
  `source_record_id` text,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_contract_deposits_project_idx` ON `project_contract_deposits` (`project_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_contract_deposits_source_idx` ON `project_contract_deposits` (`source_system`, `source_record_id`) WHERE `source_record_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_budget_applications` ADD `deposit_applied` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_budget_applications` ADD `deposit_applied_mode` text DEFAULT 'auto' NOT NULL;
