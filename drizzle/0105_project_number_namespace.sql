CREATE TABLE IF NOT EXISTS `project_number_alias_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `project_number` text NOT NULL,
  `retained_project_id` text NOT NULL,
  `discarded_project_id` text NOT NULL,
  `discarded_alias_id` text NOT NULL,
  `created_at` text NOT NULL
);--> statement-breakpoint
INSERT INTO `project_number_alias_conflicts` (
  `id`,
  `organization_id`,
  `project_number`,
  `retained_project_id`,
  `discarded_project_id`,
  `discarded_alias_id`,
  `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  candidate.`organization_id`,
  candidate.`project_number`,
  retained.`project_id`,
  candidate.`project_id`,
  candidate.`id`,
  candidate.`created_at`
FROM `project_number_aliases` AS candidate
JOIN `project_number_aliases` AS retained
  ON retained.`organization_id` = candidate.`organization_id`
  AND retained.`project_number` = candidate.`project_number` COLLATE NOCASE
  AND (
    retained.`created_at` < candidate.`created_at`
    OR (retained.`created_at` = candidate.`created_at` AND retained.`id` < candidate.`id`)
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_number_aliases` AS earlier
  WHERE earlier.`organization_id` = candidate.`organization_id`
    AND earlier.`project_number` = candidate.`project_number` COLLATE NOCASE
    AND (
      earlier.`created_at` < retained.`created_at`
      OR (earlier.`created_at` = retained.`created_at` AND earlier.`id` < retained.`id`)
    )
);--> statement-breakpoint
DELETE FROM `project_number_aliases`
WHERE EXISTS (
  SELECT 1
  FROM `project_number_aliases` AS retained
  WHERE retained.`organization_id` = `project_number_aliases`.`organization_id`
    AND retained.`project_number` = `project_number_aliases`.`project_number` COLLATE NOCASE
    AND (
      retained.`created_at` < `project_number_aliases`.`created_at`
      OR (retained.`created_at` = `project_number_aliases`.`created_at` AND retained.`id` < `project_number_aliases`.`id`)
    )
);--> statement-breakpoint
DROP INDEX `project_number_aliases_project_number_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_number_aliases_org_number_unique`
ON `project_number_aliases` (`organization_id`, `project_number` COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_project_number_unique`
ON `projects` (`organization_id`, `project_number` COLLATE NOCASE)
WHERE `project_number` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `projects_project_number_rejects_alias_on_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`project_number` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `project_number_aliases`
    WHERE `organization_id` = NEW.`organization_id`
      AND `project_number` = NEW.`project_number` COLLATE NOCASE
      AND `project_id` <> NEW.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'project number is reserved as a historical alias');
END;--> statement-breakpoint
CREATE TRIGGER `projects_project_number_rejects_alias_on_update`
BEFORE UPDATE OF `project_number`, `organization_id` ON `projects`
WHEN NEW.`project_number` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `project_number_aliases`
    WHERE `organization_id` = NEW.`organization_id`
      AND `project_number` = NEW.`project_number` COLLATE NOCASE
      AND `project_id` <> NEW.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'project number is reserved as a historical alias');
END;--> statement-breakpoint
CREATE TRIGGER `project_number_aliases_reject_current_number_on_insert`
BEFORE INSERT ON `project_number_aliases`
WHEN EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `organization_id` = NEW.`organization_id`
    AND `project_number` = NEW.`project_number` COLLATE NOCASE
    AND `id` <> NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project number is active on another project');
END;--> statement-breakpoint
CREATE TRIGGER `project_number_aliases_reject_current_number_on_update`
BEFORE UPDATE OF `project_number`, `organization_id`, `project_id` ON `project_number_aliases`
WHEN EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `organization_id` = NEW.`organization_id`
    AND `project_number` = NEW.`project_number` COLLATE NOCASE
    AND `id` <> NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'project number is active on another project');
END;
