CREATE TABLE IF NOT EXISTS `project_job_status_label_migration_staging` (
  `status_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `label` text NOT NULL,
  `normalized_label` text NOT NULL,
  CONSTRAINT `project_job_status_label_ascii` CHECK (
    instr(`label`, char(0)) = 0
    AND `label` NOT GLOB '*[^ -~]*'
    AND `label` = trim(`label`)
    AND `label` <> ''
  ),
  CHECK (instr(`normalized_label`, char(0)) = 0),
  CHECK (`normalized_label` NOT GLOB '*[^ -~]*'),
  CHECK (`normalized_label` <> '')
);--> statement-breakpoint
INSERT OR REPLACE INTO `project_job_status_label_migration_staging` (
  `status_id`,
  `organization_id`,
  `label`,
  `normalized_label`
)
SELECT
  `id`,
  `organization_id`,
  `label`,
  lower(trim(`label`))
FROM `project_job_statuses`;--> statement-breakpoint
DELETE FROM `project_job_status_label_migration_staging`
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_job_statuses`
  WHERE `project_job_statuses`.`id` = `project_job_status_label_migration_staging`.`status_id`
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_job_status_label_cross_tenant_validation` (
  `project_id` text PRIMARY KEY NOT NULL,
  `project_organization_id` text,
  `status_organization_id` text NOT NULL,
  CONSTRAINT `project_job_status_cross_tenant_reference` CHECK (
    `project_organization_id` IS NOT NULL
    AND `project_organization_id` = `status_organization_id`
  )
);--> statement-breakpoint
INSERT OR REPLACE INTO `project_job_status_label_cross_tenant_validation` (
  `project_id`,
  `project_organization_id`,
  `status_organization_id`
)
SELECT
  `projects`.`id`,
  `projects`.`organization_id`,
  candidate.`organization_id`
FROM `projects`
JOIN `project_job_statuses` AS candidate
  ON candidate.`id` = `projects`.`job_status_id`
WHERE `projects`.`organization_id` IS NULL
  OR `projects`.`organization_id` <> candidate.`organization_id`;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_job_status_label_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `normalized_label` text NOT NULL,
  `retained_status_id` text NOT NULL,
  `retained_label` text NOT NULL,
  `discarded_status_id` text NOT NULL,
  `discarded_label` text NOT NULL,
  `discarded_sage_code` text,
  `discarded_follow_up_cadence_days` integer,
  `discarded_active` integer NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_job_status_label_conflicts_org_idx`
ON `project_job_status_label_conflicts` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_job_status_label_conflicts_discarded_unique`
ON `project_job_status_label_conflicts` (`discarded_status_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `project_job_status_label_conflicts` (
  `id`,
  `organization_id`,
  `normalized_label`,
  `retained_status_id`,
  `retained_label`,
  `discarded_status_id`,
  `discarded_label`,
  `discarded_sage_code`,
  `discarded_follow_up_cadence_days`,
  `discarded_active`,
  `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  candidate.`organization_id`,
  candidate_key.`normalized_label`,
  retained.`id`,
  retained.`label`,
  candidate.`id`,
  candidate.`label`,
  candidate.`sage_code`,
  candidate.`follow_up_cadence_days`,
  candidate.`active`,
  candidate.`created_at`
FROM `project_job_statuses` AS candidate
JOIN `project_job_status_label_migration_staging` AS candidate_key
  ON candidate_key.`status_id` = candidate.`id`
JOIN `project_job_statuses` AS retained
  ON retained.`organization_id` = candidate.`organization_id`
JOIN `project_job_status_label_migration_staging` AS retained_key
  ON retained_key.`status_id` = retained.`id`
  AND retained_key.`normalized_label` = candidate_key.`normalized_label`
  AND (
    retained.`created_at` < candidate.`created_at`
    OR (retained.`created_at` = candidate.`created_at` AND retained.`id` < candidate.`id`)
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_job_statuses` AS earlier
  JOIN `project_job_status_label_migration_staging` AS earlier_key
    ON earlier_key.`status_id` = earlier.`id`
  WHERE earlier.`organization_id` = candidate.`organization_id`
    AND earlier_key.`normalized_label` = candidate_key.`normalized_label`
    AND (
      earlier.`created_at` < retained.`created_at`
      OR (earlier.`created_at` = retained.`created_at` AND earlier.`id` < retained.`id`)
    )
);--> statement-breakpoint
UPDATE `projects`
SET `job_status_id` = (
  SELECT retained.`id`
  FROM `project_job_statuses` AS candidate
  JOIN `project_job_status_label_migration_staging` AS candidate_key
    ON candidate_key.`status_id` = candidate.`id`
  JOIN `project_job_statuses` AS retained
    ON retained.`organization_id` = candidate.`organization_id`
  JOIN `project_job_status_label_migration_staging` AS retained_key
    ON retained_key.`status_id` = retained.`id`
    AND retained_key.`normalized_label` = candidate_key.`normalized_label`
    AND (
      retained.`created_at` < candidate.`created_at`
      OR (retained.`created_at` = candidate.`created_at` AND retained.`id` < candidate.`id`)
    )
  WHERE candidate.`id` = `projects`.`job_status_id`
    AND candidate.`organization_id` = `projects`.`organization_id`
  ORDER BY retained.`created_at`, retained.`id`
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `project_job_statuses` AS candidate
  JOIN `project_job_status_label_migration_staging` AS candidate_key
    ON candidate_key.`status_id` = candidate.`id`
  JOIN `project_job_statuses` AS retained
    ON retained.`organization_id` = candidate.`organization_id`
  JOIN `project_job_status_label_migration_staging` AS retained_key
    ON retained_key.`status_id` = retained.`id`
    AND retained_key.`normalized_label` = candidate_key.`normalized_label`
    AND (
      retained.`created_at` < candidate.`created_at`
      OR (retained.`created_at` = candidate.`created_at` AND retained.`id` < candidate.`id`)
    )
  WHERE candidate.`id` = `projects`.`job_status_id`
    AND candidate.`organization_id` = `projects`.`organization_id`
);--> statement-breakpoint
DELETE FROM `project_job_statuses`
WHERE EXISTS (
  SELECT 1
  FROM `project_job_statuses` AS retained
  JOIN `project_job_status_label_migration_staging` AS retained_key
    ON retained_key.`status_id` = retained.`id`
  JOIN `project_job_status_label_migration_staging` AS candidate_key
    ON candidate_key.`status_id` = `project_job_statuses`.`id`
    AND candidate_key.`normalized_label` = retained_key.`normalized_label`
  WHERE retained.`organization_id` = `project_job_statuses`.`organization_id`
    AND (
      retained.`created_at` < `project_job_statuses`.`created_at`
      OR (retained.`created_at` = `project_job_statuses`.`created_at` AND retained.`id` < `project_job_statuses`.`id`)
    )
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_job_status_label_keys` (
  `status_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `normalized_label` text NOT NULL,
  CHECK (instr(`normalized_label`, char(0)) = 0),
  CHECK (`normalized_label` NOT GLOB '*[^ -~]*'),
  CHECK (`normalized_label` <> ''),
  FOREIGN KEY (`status_id`) REFERENCES `project_job_statuses`(`id`) ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_job_status_label_keys_org_normalized_unique`
ON `project_job_status_label_keys` (`organization_id`, `normalized_label`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_status_label_keys_integrity_insert`
BEFORE INSERT ON `project_job_status_label_keys`
WHEN NOT EXISTS (
  SELECT 1
  FROM `project_job_statuses`
  WHERE `id` = NEW.`status_id`
    AND `organization_id` = NEW.`organization_id`
    AND lower(trim(`label`)) = NEW.`normalized_label`
)
BEGIN
  SELECT RAISE(ABORT, 'Project job-status label key must match its status.');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_status_label_keys_integrity_update`
BEFORE UPDATE OF `status_id`, `organization_id`, `normalized_label` ON `project_job_status_label_keys`
WHEN NOT EXISTS (
  SELECT 1
  FROM `project_job_statuses`
  WHERE `id` = NEW.`status_id`
    AND `organization_id` = NEW.`organization_id`
    AND lower(trim(`label`)) = NEW.`normalized_label`
)
BEGIN
  SELECT RAISE(ABORT, 'Project job-status label key must match its status.');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_status_label_keys_integrity_delete`
BEFORE DELETE ON `project_job_status_label_keys`
WHEN EXISTS (
  SELECT 1
  FROM `project_job_statuses`
  WHERE `id` = OLD.`status_id`
)
BEGIN
  SELECT RAISE(ABORT, 'Project job-status label key cannot be removed while its status exists.');
END;--> statement-breakpoint
INSERT INTO `project_job_status_label_keys` (`status_id`, `organization_id`, `normalized_label`)
SELECT `id`, `organization_id`, lower(trim(`label`))
FROM `project_job_statuses`
WHERE 1
ON CONFLICT(`status_id`) DO UPDATE SET
  `organization_id` = excluded.`organization_id`,
  `normalized_label` = excluded.`normalized_label`;--> statement-breakpoint
DELETE FROM `project_job_status_label_keys`
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_job_statuses`
  WHERE `project_job_statuses`.`id` = `project_job_status_label_keys`.`status_id`
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_statuses_ascii_namespace_insert`
BEFORE INSERT ON `project_job_statuses`
WHEN NEW.`label` = ''
  OR instr(NEW.`label`, char(0)) <> 0
  OR NEW.`label` GLOB '*[^ -~]*'
  OR NEW.`label` <> trim(NEW.`label`)
BEGIN
  SELECT RAISE(ABORT, 'Project job-status labels must be non-empty, trimmed printable ASCII.');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_statuses_ascii_namespace_update`
BEFORE UPDATE OF `label`, `organization_id` ON `project_job_statuses`
WHEN NEW.`label` = ''
  OR instr(NEW.`label`, char(0)) <> 0
  OR NEW.`label` GLOB '*[^ -~]*'
  OR NEW.`label` <> trim(NEW.`label`)
BEGIN
  SELECT RAISE(ABORT, 'Project job-status labels must be non-empty, trimmed printable ASCII.');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_statuses_ascii_namespace_key_insert`
AFTER INSERT ON `project_job_statuses`
BEGIN
  INSERT INTO `project_job_status_label_keys` (`status_id`, `organization_id`, `normalized_label`)
  VALUES (NEW.`id`, NEW.`organization_id`, lower(trim(NEW.`label`)));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_statuses_ascii_namespace_key_update`
AFTER UPDATE OF `label`, `organization_id` ON `project_job_statuses`
BEGIN
  UPDATE `project_job_status_label_keys`
  SET
    `organization_id` = NEW.`organization_id`,
    `normalized_label` = lower(trim(NEW.`label`))
  WHERE `status_id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `project_job_statuses_ascii_namespace_key_delete`
AFTER DELETE ON `project_job_statuses`
BEGIN
  DELETE FROM `project_job_status_label_keys` WHERE `status_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_project_job_status_namespace_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`job_status_id` IS NULL
  OR (
    NEW.`job_status_id` NOT IN (
      'intake', 'new_client_info_sent', 'budget_estimating', 'budget_estimate_sent',
      'estimating', 'estimate_sent', 'design_proposal', 'design_proposal_sent',
      'design_proposal_signed', 'engineering', 'contract_docs', 'contract_docs_sent',
      'contract_docs_signed', 'contract', 'awarded', 'awaiting_funding',
      'awaiting_groundbreaking', 'permitting', 'in_design', 'value_engineering',
      'takeoff', 'bracing_out', 'under_construction', 'ordered', 'partial_order',
      'price_sheet_sent', 'shipping_tbd', 'awaiting_payment', 'current', 'punchlist',
      'complete', 'closed', 'bid_refused', 'inactive'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM `project_job_statuses`
      WHERE `id` = NEW.`job_status_id`
        AND NEW.`organization_id` IS NOT NULL
        AND `organization_id` = NEW.`organization_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Project job status must be an approved built-in or organization-owned custom status.');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_project_job_status_namespace_update`
BEFORE UPDATE OF `job_status_id`, `organization_id` ON `projects`
WHEN NEW.`job_status_id` IS NULL
  OR (
    NEW.`job_status_id` NOT IN (
      'intake', 'new_client_info_sent', 'budget_estimating', 'budget_estimate_sent',
      'estimating', 'estimate_sent', 'design_proposal', 'design_proposal_sent',
      'design_proposal_signed', 'engineering', 'contract_docs', 'contract_docs_sent',
      'contract_docs_signed', 'contract', 'awarded', 'awaiting_funding',
      'awaiting_groundbreaking', 'permitting', 'in_design', 'value_engineering',
      'takeoff', 'bracing_out', 'under_construction', 'ordered', 'partial_order',
      'price_sheet_sent', 'shipping_tbd', 'awaiting_payment', 'current', 'punchlist',
      'complete', 'closed', 'bid_refused', 'inactive'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM `project_job_statuses`
      WHERE `id` = NEW.`job_status_id`
        AND NEW.`organization_id` IS NOT NULL
        AND `organization_id` = NEW.`organization_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Project job status must be an approved built-in or organization-owned custom status.');
END;--> statement-breakpoint
DROP TABLE `project_job_status_label_cross_tenant_validation`;--> statement-breakpoint
DROP TABLE `project_job_status_label_migration_staging`;