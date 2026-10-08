-- GCSSC phase imports used a historical contact person's name as the client.
-- Restore the phase snapshot from the base project and hold every pending Sage
-- handoff until a developer explicitly confirms the client/company.
INSERT INTO `project_profile_audit_events` (
  `id`,
  `organization_id`,
  `project_id`,
  `actor_user_id`,
  `event_type`,
  `entity_type`,
  `entity_id`,
  `before_json`,
  `after_json`,
  `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  phase.`organization_id`,
  phase.`id`,
  NULL,
  'project.phase_client_snapshot_repaired',
  'project',
  phase.`id`,
  json_object('clientName', phase.`client_name`),
  json_object('clientName', base.`client_name`, 'sourceProjectNumber', base.`project_number`),
  datetime('now')
FROM `projects` AS phase
INNER JOIN `projects` AS base
  ON base.`organization_id` = phase.`organization_id`
 AND base.`project_number` = 'O-31-2067'
WHERE phase.`project_number` IN (
  'O-31-2067-1',
  'O-31-2067-2',
  'O-31-2067-3',
  'O-31-2067-4',
  'O-31-2067-5'
)
  AND phase.`client_name` = 'Phil Chase'
  AND base.`client_name` IS NOT NULL
  AND trim(base.`client_name`) <> '';--> statement-breakpoint

INSERT INTO `project_profile_audit_events` (
  `id`,
  `organization_id`,
  `project_id`,
  `actor_user_id`,
  `event_type`,
  `entity_type`,
  `entity_id`,
  `before_json`,
  `after_json`,
  `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  phase.`organization_id`,
  phase.`id`,
  NULL,
  'project.sage_handoff_client_review_required',
  'project_operation',
  operation.`id`,
  json_object(
    'companyName', operation.`company_name`,
    'sageWriteStatus', operation.`sage_write_status`,
    'syncStatus', operation.`sync_status`
  ),
  json_object(
    'companyName', base.`client_name`,
    'sageWriteStatus', 'not_ready',
    'syncStatus', 'needs_review'
  ),
  datetime('now')
FROM `project_operations` AS operation
INNER JOIN `projects` AS phase ON phase.`id` = operation.`project_id`
INNER JOIN `projects` AS base
  ON base.`organization_id` = phase.`organization_id`
 AND base.`project_number` = 'O-31-2067'
WHERE operation.`source_system` = 'google_project_manager'
  AND operation.`source_record_type` = 'sage_project_handoff'
  AND operation.`source_record_id` IN (
    'O-31-2067-1',
    'O-31-2067-2',
    'O-31-2067-3',
    'O-31-2067-4',
    'O-31-2067-5'
  )
  AND operation.`company_name` = 'Phil Chase'
  AND operation.`sync_status` NOT IN ('queued_sage', 'syncing', 'synced')
  AND base.`client_name` IS NOT NULL
  AND trim(base.`client_name`) <> '';--> statement-breakpoint

UPDATE `project_operations`
SET
  `company_name` = (
    SELECT base.`client_name`
    FROM `projects` AS phase
    INNER JOIN `projects` AS base
      ON base.`organization_id` = phase.`organization_id`
     AND base.`project_number` = 'O-31-2067'
    WHERE phase.`id` = `project_operations`.`project_id`
    LIMIT 1
  ),
  `description` = 'Confirm the client/company before queueing this phased project for Sage. The Google contact name is retained only in the source payload.',
  `status` = 'needs_review',
  `sage_write_status` = 'not_ready',
  `sync_status` = 'needs_review',
  `updated_at` = datetime('now')
WHERE `source_system` = 'google_project_manager'
  AND `source_record_type` = 'sage_project_handoff'
  AND `source_record_id` IN (
    'O-31-2067-1',
    'O-31-2067-2',
    'O-31-2067-3',
    'O-31-2067-4',
    'O-31-2067-5'
  )
  AND `company_name` = 'Phil Chase'
  AND `sync_status` NOT IN ('queued_sage', 'syncing', 'synced')
  AND EXISTS (
    SELECT 1
    FROM `projects` AS phase
    INNER JOIN `projects` AS base
      ON base.`organization_id` = phase.`organization_id`
     AND base.`project_number` = 'O-31-2067'
    WHERE phase.`id` = `project_operations`.`project_id`
      AND base.`client_name` IS NOT NULL
      AND trim(base.`client_name`) <> ''
  );--> statement-breakpoint

UPDATE `projects`
SET
  `client_name` = (
    SELECT base.`client_name`
    FROM `projects` AS base
    WHERE base.`organization_id` = `projects`.`organization_id`
      AND base.`project_number` = 'O-31-2067'
    LIMIT 1
  ),
  `updated_at` = datetime('now')
WHERE `project_number` IN (
  'O-31-2067-1',
  'O-31-2067-2',
  'O-31-2067-3',
  'O-31-2067-4',
  'O-31-2067-5'
)
  AND `client_name` = 'Phil Chase'
  AND EXISTS (
    SELECT 1
    FROM `projects` AS base
    WHERE base.`organization_id` = `projects`.`organization_id`
      AND base.`project_number` = 'O-31-2067'
      AND base.`client_name` IS NOT NULL
      AND trim(base.`client_name`) <> ''
  );
