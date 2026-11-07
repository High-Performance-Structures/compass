-- Shop ticket amounts imported into owner pay applications (G702/G703).
-- One row per ticket per G703 line it added to ("imported"), or one row with
-- no line when staff mark a ticket as already included by hand
-- ("already_included"). Additive only: a new table and its indexes, no data
-- changes, no table rebuilds.
CREATE TABLE IF NOT EXISTS `pay_application_shop_ticket_imports` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE CASCADE,
  `ticket_id` text NOT NULL REFERENCES `shop_tickets`(`id`) ON DELETE CASCADE,
  `budget_line_id` text REFERENCES `project_budget_lines`(`id`) ON DELETE CASCADE,
  `amount_cents` integer DEFAULT 0 NOT NULL,
  `mode` text NOT NULL,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pay_application_shop_ticket_imports_line_idx`
  ON `pay_application_shop_ticket_imports` (`application_id`, `ticket_id`, `budget_line_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pay_application_shop_ticket_imports_mark_idx`
  ON `pay_application_shop_ticket_imports` (`application_id`, `ticket_id`) WHERE "budget_line_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_shop_ticket_imports_ticket_idx`
  ON `pay_application_shop_ticket_imports` (`ticket_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_shop_ticket_imports_budget_line_idx`
  ON `pay_application_shop_ticket_imports` (`budget_line_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_shop_ticket_imports_created_by_idx`
  ON `pay_application_shop_ticket_imports` (`created_by`);
