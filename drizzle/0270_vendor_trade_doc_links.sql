-- Secure no-login links a vendor (or their insurance agent) uses to send
-- trade docs and fill in the info sheet. Only the SHA-256 hash of the token
-- is stored, so a database read can't be turned back into a working link.
CREATE TABLE `vendor_trade_doc_links` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `vendor_id` text NOT NULL REFERENCES `vendors`(`id`) ON DELETE cascade,
  `token_hash` text NOT NULL,
  `audience` text NOT NULL DEFAULT 'vendor',
  `recipient_email` text NOT NULL,
  `requested_json` text NOT NULL,
  `parent_link_id` text REFERENCES `vendor_trade_doc_links`(`id`) ON DELETE set null,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  `revoked_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `last_opened_at` text,
  `last_submitted_at` text,
  `upload_count` integer NOT NULL DEFAULT 0,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_by_name` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_trade_doc_links_token_uq` ON `vendor_trade_doc_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `vendor_trade_doc_links_vendor_idx` ON `vendor_trade_doc_links` (`vendor_id`, `created_at`);
