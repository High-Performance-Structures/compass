CREATE TABLE `project_change_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `change_order_number` text NOT NULL,
  `title` text NOT NULL,
  `scope` text NOT NULL,
  `reason` text,
  `amount_cents` integer,
  `status` text NOT NULL DEFAULT 'draft',
  `audience` text NOT NULL DEFAULT 'internal',
  `requester_type` text NOT NULL,
  `requester_user_id` text,
  `requester_name` text NOT NULL,
  `requester_company` text,
  `source_type` text NOT NULL,
  `source_record_id` text,
  `source_href` text,
  `internal_notes` text,
  `foxit_status` text NOT NULL DEFAULT 'not_started',
  `foxit_envelope_id` text,
  `signature_requested_at` text,
  `executed_at` text,
  `sage_status` text NOT NULL DEFAULT 'not_ready',
  `sage_record_id` text,
  `last_sage_sync_at` text,
  `created_by` text,
  `submitted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_change_orders_project_number_uq`
  ON `project_change_orders` (`project_id`, `change_order_number`);
--> statement-breakpoint
CREATE INDEX `project_change_orders_project_status_idx`
  ON `project_change_orders` (`project_id`, `status`);
--> statement-breakpoint
CREATE INDEX `project_change_orders_requester_idx`
  ON `project_change_orders` (`project_id`, `requester_user_id`);
--> statement-breakpoint
CREATE TABLE `project_change_order_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `change_order_id` text NOT NULL,
  `label` text NOT NULL,
  `url` text NOT NULL,
  `notes` text,
  `created_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`change_order_id`) REFERENCES `project_change_orders`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_change_order_documents_order_idx`
  ON `project_change_order_documents` (`change_order_id`);
--> statement-breakpoint
CREATE INDEX `project_change_order_documents_project_idx`
  ON `project_change_order_documents` (`project_id`);
--> statement-breakpoint
CREATE TABLE `project_change_order_history` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `change_order_id` text NOT NULL,
  `event_type` text NOT NULL,
  `from_status` text,
  `to_status` text,
  `actor_user_id` text,
  `actor_name` text NOT NULL,
  `actor_role` text NOT NULL,
  `note` text,
  `metadata_json` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`change_order_id`) REFERENCES `project_change_orders`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_change_order_history_order_idx`
  ON `project_change_order_history` (`change_order_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `project_change_order_history_project_idx`
  ON `project_change_order_history` (`project_id`);
