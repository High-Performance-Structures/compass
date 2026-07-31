CREATE TABLE `buildertrend_staging_identity_review_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `review_key` text NOT NULL,
  `manifest_fingerprint` text NOT NULL,
  `status` text DEFAULT 'in_progress' NOT NULL CHECK (`status` IN ('in_progress', 'completed', 'manifest_conflict')),
  `expected_decision_count` integer NOT NULL CHECK (`expected_decision_count` >= 0),
  `expected_relationship_count` integer NOT NULL CHECK (`expected_relationship_count` >= 0),
  `reviewed_by` text,
  `reviewed_at` text NOT NULL,
  `summary_json` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_identity_review_runs_org_key_unique`
ON `buildertrend_staging_identity_review_runs` (`organization_id`, `review_key`);
--> statement-breakpoint
CREATE INDEX `buildertrend_identity_review_runs_org_status_idx`
ON `buildertrend_staging_identity_review_runs` (`organization_id`, `status`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_identity_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `review_run_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `source_record_id` text NOT NULL,
  `source_key` text NOT NULL,
  `source_identity_kind` text NOT NULL CHECK (`source_identity_kind` IN ('job', 'lead')),
  `source_identity_id` text NOT NULL,
  `lifecycle_status` text NOT NULL CHECK (`lifecycle_status` IN ('active', 'preconstruction', 'warranty', 'completed', 'inactive', 'archived', 'ignored')),
  `disposition` text NOT NULL CHECK (`disposition` IN ('existing_project', 'project_candidate', 'lead_only', 'archive_only', 'ignored', 'unmatched')),
  `department_code` text,
  `matched_project_id` text,
  `customer_provenance_id` text,
  `customer_provenance_kind` text DEFAULT 'none' NOT NULL CHECK (`customer_provenance_kind` IN ('none', 'named_customer', 'pooled_accounting', 'prospect')),
  `portal_identity_allowed` integer DEFAULT 0 NOT NULL CHECK (`portal_identity_allowed` = 0),
  `review_status` text DEFAULT 'needs_review' NOT NULL CHECK (`review_status` IN ('needs_review', 'approved', 'rejected')),
  `review_notes` text,
  `created_at` text NOT NULL,
  CHECK (`disposition` <> 'existing_project' OR `matched_project_id` IS NOT NULL),
  CHECK (`customer_provenance_kind` = 'none' OR `customer_provenance_id` IS NOT NULL),
  CHECK (`customer_provenance_kind` <> 'none' OR `customer_provenance_id` IS NULL),
  FOREIGN KEY (`review_run_id`) REFERENCES `buildertrend_staging_identity_review_runs`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_record_id`) REFERENCES `buildertrend_staging_records`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`matched_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`customer_provenance_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_identity_decisions_run_source_unique`
ON `buildertrend_staging_identity_decisions` (`review_run_id`, `source_record_id`);
--> statement-breakpoint
CREATE INDEX `buildertrend_identity_decisions_org_status_idx`
ON `buildertrend_staging_identity_decisions` (`organization_id`, `review_status`);
--> statement-breakpoint
CREATE INDEX `buildertrend_identity_decisions_project_idx`
ON `buildertrend_staging_identity_decisions` (`matched_project_id`);
--> statement-breakpoint
CREATE TABLE `buildertrend_staging_identity_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `review_run_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `from_decision_id` text NOT NULL,
  `to_decision_id` text NOT NULL,
  `relationship_type` text NOT NULL CHECK (`relationship_type` IN ('same_owner', 'development_phase', 'continuation', 'department_transition', 'lead_conversion')),
  `review_status` text DEFAULT 'needs_review' NOT NULL CHECK (`review_status` IN ('needs_review', 'approved', 'rejected')),
  `review_notes` text,
  `grants_portal_access` integer DEFAULT 0 NOT NULL CHECK (`grants_portal_access` = 0),
  `created_at` text NOT NULL,
  CHECK (`from_decision_id` <> `to_decision_id`),
  FOREIGN KEY (`review_run_id`) REFERENCES `buildertrend_staging_identity_review_runs`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`from_decision_id`) REFERENCES `buildertrend_staging_identity_decisions`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`to_decision_id`) REFERENCES `buildertrend_staging_identity_decisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `buildertrend_identity_relationships_run_edge_unique`
ON `buildertrend_staging_identity_relationships` (`review_run_id`, `from_decision_id`, `to_decision_id`, `relationship_type`);
--> statement-breakpoint
CREATE INDEX `buildertrend_identity_relationships_org_type_idx`
ON `buildertrend_staging_identity_relationships` (`organization_id`, `relationship_type`);
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_review_run_scope_guard`
BEFORE INSERT ON `buildertrend_staging_identity_review_runs`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `organizations`
    WHERE `id` = NEW.`organization_id`
  )
  OR (
    NEW.`reviewed_by` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM `users`
      WHERE `id` = NEW.`reviewed_by`
        AND `organization_id` = NEW.`organization_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity review runs must remain organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_decision_scope_guard`
BEFORE INSERT ON `buildertrend_staging_identity_decisions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `buildertrend_staging_identity_review_runs` review_run
  JOIN `buildertrend_staging_records` source_record
    ON source_record.`id` = NEW.`source_record_id`
  WHERE review_run.`id` = NEW.`review_run_id`
    AND review_run.`organization_id` = NEW.`organization_id`
    AND source_record.`organization_id` = NEW.`organization_id`
    AND source_record.`source_key` = NEW.`source_key`
    AND (
      (
        NEW.`source_identity_kind` = 'job'
        AND source_record.`buildertrend_job_id` = NEW.`source_identity_id`
      )
      OR (
        NEW.`source_identity_kind` = 'lead'
        AND source_record.`buildertrend_lead_id` = NEW.`source_identity_id`
      )
    )
    AND (
      NEW.`matched_project_id` IS NULL
      OR EXISTS (
        SELECT 1 FROM `projects`
        WHERE `id` = NEW.`matched_project_id`
          AND `organization_id` = NEW.`organization_id`
      )
    )
    AND (
      NEW.`customer_provenance_id` IS NULL
      OR EXISTS (
        SELECT 1 FROM `customers`
        WHERE `id` = NEW.`customer_provenance_id`
          AND `organization_id` = NEW.`organization_id`
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity decisions must remain organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_relationship_scope_guard`
BEFORE INSERT ON `buildertrend_staging_identity_relationships`
WHEN NOT EXISTS (
  SELECT 1
  FROM `buildertrend_staging_identity_review_runs` review_run
  JOIN `buildertrend_staging_identity_decisions` from_decision
    ON from_decision.`id` = NEW.`from_decision_id`
  JOIN `buildertrend_staging_identity_decisions` to_decision
    ON to_decision.`id` = NEW.`to_decision_id`
  WHERE review_run.`id` = NEW.`review_run_id`
    AND review_run.`organization_id` = NEW.`organization_id`
    AND from_decision.`review_run_id` = NEW.`review_run_id`
    AND to_decision.`review_run_id` = NEW.`review_run_id`
    AND from_decision.`organization_id` = NEW.`organization_id`
    AND to_decision.`organization_id` = NEW.`organization_id`
    AND (
      NEW.`review_status` <> 'approved'
      OR (
        from_decision.`review_status` = 'approved'
        AND to_decision.`review_status` = 'approved'
      )
    )
    AND (
      NEW.`relationship_type` <> 'department_transition'
      OR (
        from_decision.`department_code` IS NOT NULL
        AND to_decision.`department_code` IS NOT NULL
        AND from_decision.`department_code` <> to_decision.`department_code`
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity relationships must remain review-run and organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_lead_conversion_guard`
BEFORE INSERT ON `buildertrend_staging_identity_relationships`
WHEN NEW.`relationship_type` = 'lead_conversion'
  AND NOT EXISTS (
    SELECT 1
    FROM `buildertrend_staging_identity_decisions` from_decision
    JOIN `buildertrend_staging_identity_decisions` to_decision
      ON to_decision.`id` = NEW.`to_decision_id`
    WHERE from_decision.`id` = NEW.`from_decision_id`
      AND from_decision.`source_identity_kind` = 'lead'
      AND to_decision.`source_identity_kind` = 'job'
  )
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend lead conversion must link a lead decision to a job decision');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_review_completion_guard`
BEFORE UPDATE OF `status` ON `buildertrend_staging_identity_review_runs`
WHEN NEW.`status` = 'completed'
  AND (
    (SELECT COUNT(*) FROM `buildertrend_staging_identity_decisions`
      WHERE `review_run_id` = NEW.`id`) <> NEW.`expected_decision_count`
    OR
    (SELECT COUNT(*) FROM `buildertrend_staging_identity_relationships`
      WHERE `review_run_id` = NEW.`id`) <> NEW.`expected_relationship_count`
  )
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity review cannot complete with unresolved references');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_review_run_identity_guard`
BEFORE UPDATE ON `buildertrend_staging_identity_review_runs`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`review_key` IS NOT OLD.`review_key`
  OR NEW.`manifest_fingerprint` IS NOT OLD.`manifest_fingerprint`
  OR NEW.`expected_decision_count` IS NOT OLD.`expected_decision_count`
  OR NEW.`expected_relationship_count` IS NOT OLD.`expected_relationship_count`
  OR NEW.`reviewed_by` IS NOT OLD.`reviewed_by`
  OR NEW.`reviewed_at` IS NOT OLD.`reviewed_at`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity review provenance is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_review_run_delete_guard`
BEFORE DELETE ON `buildertrend_staging_identity_review_runs`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity review runs cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_decision_update_guard`
BEFORE UPDATE ON `buildertrend_staging_identity_decisions`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_decision_delete_guard`
BEFORE DELETE ON `buildertrend_staging_identity_decisions`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity decisions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_relationship_update_guard`
BEFORE UPDATE ON `buildertrend_staging_identity_relationships`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity relationships are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_relationship_delete_guard`
BEFORE DELETE ON `buildertrend_staging_identity_relationships`
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity relationships cannot be deleted');
END;
