-- Staff mark an imported (Sage or Drive) draw "Paid before Compass": it was
-- settled outside Compass, so no payment details are entered for it.
-- Additive only: a new table with no rows. Undoing a mark releases it with a
-- reason; released rows stay as history. At most one active mark per draw.
CREATE TABLE IF NOT EXISTS `pay_application_prepaid_marks` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `application_id` text NOT NULL REFERENCES `project_budget_applications`(`id`) ON DELETE RESTRICT,
  `note` text,
  `marked_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `marked_at` text NOT NULL,
  `released_at` text,
  `released_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `release_reason` text,
  CONSTRAINT `pay_application_prepaid_marks_release_check`
    CHECK((`released_at` IS NULL AND `release_reason` IS NULL)
      OR (`released_at` IS NOT NULL AND `release_reason` IS NOT NULL AND length(trim(`release_reason`)) > 0)),
  CONSTRAINT `pay_application_prepaid_marks_project_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`)
    REFERENCES `projects`(`organization_id`, `id`)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pay_application_prepaid_marks_active_unique` ON `pay_application_prepaid_marks` (`application_id`) WHERE `released_at` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_prepaid_marks_application_idx` ON `pay_application_prepaid_marks` (`application_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_prepaid_marks_scope_idx` ON `pay_application_prepaid_marks` (`organization_id`, `project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_prepaid_marks_project_id_idx` ON `pay_application_prepaid_marks` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_prepaid_marks_marked_by_idx` ON `pay_application_prepaid_marks` (`marked_by`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pay_application_prepaid_marks_released_by_idx` ON `pay_application_prepaid_marks` (`released_by`);
