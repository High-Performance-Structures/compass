-- Secure no-login price links in RFQ emails. Only a SHA-256 hash of each
-- link's token is stored; the token itself appears only in the email.
CREATE TABLE `project_rfq_quote_links` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE cascade,
  `rfq_operation_id` text NOT NULL REFERENCES `project_operations`(`id`) ON DELETE cascade,
  `token_hash` text NOT NULL,
  `recipient_email` text NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  `revoked_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `last_opened_at` text,
  `submitted_at` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_rfq_quote_links_token_uq` ON `project_rfq_quote_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `project_rfq_quote_links_rfq_idx` ON `project_rfq_quote_links` (`rfq_operation_id`, `created_at`);
