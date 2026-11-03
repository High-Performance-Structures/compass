-- Record a received payment against a pay application or invoice.
-- Additive only: new columns are nullable, and the new table has no rows.
-- A payment is voided (never deleted) once applied; voiding releases its
-- allocation rows, which stay as history and stop counting toward balances.
ALTER TABLE `payments` ADD `voided_at` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD `voided_by` text REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `payments` ADD `void_reason` text CONSTRAINT `payments_void_reason_check` CHECK(`void_reason` IS NULL OR length(trim(`void_reason`)) > 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payments_voided_by_idx` ON `payments` (`voided_by`);
--> statement-breakpoint
ALTER TABLE `invoice_payment_allocations` ADD `released_at` text;
--> statement-breakpoint
ALTER TABLE `invoice_payment_allocations` ADD `released_by` text REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_payment_allocations_payment_idx` ON `invoice_payment_allocations` (`payment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invoice_payment_allocations_released_by_idx` ON `invoice_payment_allocations` (`released_by`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pay_application_payment_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE RESTRICT,
  `payment_id` text NOT NULL,
  `allocation_cents` integer NOT NULL,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `released_at` text,
  `released_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `pay_application_payment_allocations_positive_check`
    CHECK(typeof(`allocation_cents`) = 'integer' AND `allocation_cents` BETWEEN 1 AND 9007199254740991),
  CONSTRAINT `pay_application_payment_allocations_project_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`)
    REFERENCES `projects`(`organization_id`, `id`)
    ON DELETE RESTRICT,
  CONSTRAINT `pay_application_payment_allocations_payment_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`, `payment_id`)
    REFERENCES `payments`(`organization_id`, `project_id`, `id`)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pay_application_payment_allocations_pair_unique` ON `pay_application_payment_allocations` (`application_id`, `payment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_payment_allocations_payment_idx` ON `pay_application_payment_allocations` (`payment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_payment_allocations_scope_idx` ON `pay_application_payment_allocations` (`organization_id`, `project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_payment_allocations_project_id_idx` ON `pay_application_payment_allocations` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_payment_allocations_created_by_idx` ON `pay_application_payment_allocations` (`created_by`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_payment_allocations_released_by_idx` ON `pay_application_payment_allocations` (`released_by`);
