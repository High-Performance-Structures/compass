CREATE TABLE `sage_pay_application_sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `requested_by_user_id` text,
  `idempotency_key` text NOT NULL,
  `sage_job_id` text,
  `sage_job_number` text,
  `status` text DEFAULT 'queued' NOT NULL,
  `claim_token` text,
  `claimed_at` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `source_application_id` text,
  `source_revision` text,
  `source_hash` text,
  `snapshot_id` text,
  `reconciliation_json` text,
  `error_message` text,
  `requested_at` text NOT NULL,
  `captured_at` text,
  `completed_at` text,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_pay_app_sync_runs_idempotency_idx`
  ON `sage_pay_application_sync_runs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `sage_pay_app_sync_runs_project_status_idx`
  ON `sage_pay_application_sync_runs` (`project_id`, `status`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `sage_pay_app_sync_runs_claim_idx`
  ON `sage_pay_application_sync_runs` (`status`, `claimed_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_pay_app_sync_runs_active_project_idx`
  ON `sage_pay_application_sync_runs` (`project_id`)
  WHERE `status` IN ('queued', 'running', 'processing');
--> statement-breakpoint
CREATE TABLE `sage_pay_application_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `source_application_id` text NOT NULL,
  `source_revision` text NOT NULL,
  `source_hash` text NOT NULL,
  `application_number` text NOT NULL,
  `period_to` text,
  `row_count` integer NOT NULL,
  `header_json` text NOT NULL,
  `lines_json` text NOT NULL,
  `reconciliation_json` text NOT NULL,
  `captured_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `sage_pay_application_sync_runs`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_pay_app_snapshots_source_revision_idx`
  ON `sage_pay_application_snapshots` (`project_id`, `source_application_id`, `source_revision`, `source_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sage_pay_app_snapshots_run_idx`
  ON `sage_pay_application_snapshots` (`run_id`);
--> statement-breakpoint
CREATE INDEX `sage_pay_app_snapshots_project_captured_idx`
  ON `sage_pay_application_snapshots` (`project_id`, `captured_at`);
--> statement-breakpoint
CREATE TABLE `sage_bridge_request_nonces` (
  `request_id` text PRIMARY KEY NOT NULL,
  `route` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sage_bridge_request_nonces_created_idx`
  ON `sage_bridge_request_nonces` (`created_at`);
--> statement-breakpoint
CREATE TABLE `sage_bridge_status` (
  `id` text PRIMARY KEY NOT NULL,
  `last_seen_at` text NOT NULL,
  `updated_at` text NOT NULL
);
