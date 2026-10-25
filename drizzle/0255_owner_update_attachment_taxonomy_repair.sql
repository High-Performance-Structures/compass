-- Owner-update attachments are classified by selection provenance: an id in
-- selected_photo_ids is a photo, an id in a valid composer snapshot's documents
-- is a document, and an id in both is ambiguous and never granted. Stored MIME
-- types are never used to classify. Snapshot documents come only from
-- owner_update_valid_snapshot_documents, a fail-closed subset of the runtime
-- composer snapshot parser (including duplicate-key rejection).
DROP VIEW IF EXISTS `owner_update_valid_snapshot_documents`;
--> statement-breakpoint
CREATE VIEW `owner_update_valid_snapshot_documents` AS
WITH `normalized_snapshots` AS (
  SELECT
    `owner_project_updates`.`id` AS `owner_update_id`,
    CASE
      WHEN json_valid(`owner_project_updates`.`schedule_snapshot`)
      THEN CASE
        WHEN json_type(`owner_project_updates`.`schedule_snapshot`) = 'object'
        THEN `owner_project_updates`.`schedule_snapshot`
        ELSE NULL
      END
      ELSE NULL
    END AS `snapshot`
  FROM `owner_project_updates`
),
`valid_snapshots` AS (
  SELECT `owner_update_id`, `snapshot`
  FROM `normalized_snapshots`
  WHERE `snapshot` IS NOT NULL
    AND json_type(`snapshot`, '$.version') = 'integer'
    AND json_extract(`snapshot`, '$.version') = 2
    AND json_type(`snapshot`, '$.completedScheduleItems') = 'array'
    AND json_type(`snapshot`, '$.lookAheadScheduleItems') = 'array'
    AND json_type(`snapshot`, '$.todos') = 'array'
    AND json_type(`snapshot`, '$.documents') = 'array'
    -- JSON.parse keeps the last duplicate object key while SQLite JSON1
    -- keeps the first. Reject duplicates so both parsers authorize the same data.
    AND NOT EXISTS (
      SELECT 1
      FROM json_tree(`snapshot`) AS `node`
      WHERE `node`.`key` IS NOT NULL
      GROUP BY `node`.`parent`, `node`.`key`
      HAVING count(*) > 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(`snapshot`, '$.completedScheduleItems') AS `item`
      WHERE CASE
        WHEN `item`.`type` IS NOT 'object' THEN 1
        WHEN json_type(`item`.`value`, '$.id') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.id')) = ''
          OR json_type(`item`.`value`, '$.title') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.title')) = ''
          OR json_type(`item`.`value`, '$.startDate') IS NOT 'text'
          OR length(json_extract(`item`.`value`, '$.startDate')) <> 10
          OR json_extract(`item`.`value`, '$.startDate') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          OR json_type(`item`.`value`, '$.endDate') IS NOT 'text'
          OR length(json_extract(`item`.`value`, '$.endDate')) <> 10
          OR json_extract(`item`.`value`, '$.endDate') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          OR COALESCE(json_type(`item`.`value`, '$.assignedTo'), 'missing') NOT IN ('text', 'null')
          OR json_type(`item`.`value`, '$.status') IS NOT 'text'
          OR COALESCE(json_type(`item`.`value`, '$.percentComplete'), 'missing') NOT IN ('integer', 'real')
          OR json_extract(`item`.`value`, '$.percentComplete') < 0
          OR json_extract(`item`.`value`, '$.percentComplete') > 100
          OR json_type(`item`.`value`, '$.notes') IS NOT 'text'
        THEN 1
        ELSE 0
      END = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(`snapshot`, '$.lookAheadScheduleItems') AS `item`
      WHERE CASE
        WHEN `item`.`type` IS NOT 'object' THEN 1
        WHEN json_type(`item`.`value`, '$.id') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.id')) = ''
          OR json_type(`item`.`value`, '$.title') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.title')) = ''
          OR json_type(`item`.`value`, '$.startDate') IS NOT 'text'
          OR length(json_extract(`item`.`value`, '$.startDate')) <> 10
          OR json_extract(`item`.`value`, '$.startDate') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          OR json_type(`item`.`value`, '$.endDate') IS NOT 'text'
          OR length(json_extract(`item`.`value`, '$.endDate')) <> 10
          OR json_extract(`item`.`value`, '$.endDate') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          OR COALESCE(json_type(`item`.`value`, '$.assignedTo'), 'missing') NOT IN ('text', 'null')
          OR json_type(`item`.`value`, '$.status') IS NOT 'text'
          OR COALESCE(json_type(`item`.`value`, '$.percentComplete'), 'missing') NOT IN ('integer', 'real')
          OR json_extract(`item`.`value`, '$.percentComplete') < 0
          OR json_extract(`item`.`value`, '$.percentComplete') > 100
          OR json_type(`item`.`value`, '$.notes') IS NOT 'text'
        THEN 1
        ELSE 0
      END = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(`snapshot`, '$.todos') AS `item`
      WHERE CASE
        WHEN `item`.`type` IS NOT 'object' THEN 1
        WHEN json_type(`item`.`value`, '$.id') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.id')) = ''
          OR json_type(`item`.`value`, '$.title') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.title')) = ''
          OR json_type(`item`.`value`, '$.description') IS NOT 'text'
          OR json_type(`item`.`value`, '$.status') IS NOT 'text'
          OR json_type(`item`.`value`, '$.priority') IS NOT 'text'
          OR COALESCE(json_type(`item`.`value`, '$.assigneeName'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.companyName'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.dueDate'), 'missing') NOT IN ('text', 'null')
          OR json_type(`item`.`value`, '$.timing') IS NOT 'text'
          OR COALESCE(json_extract(`item`.`value`, '$.timing'), 'missing') NOT IN ('reporting_period', 'upcoming')
          OR json_type(`item`.`value`, '$.notes') IS NOT 'text'
        THEN 1
        ELSE 0
      END = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(`snapshot`, '$.documents') AS `item`
      WHERE CASE
        WHEN `item`.`type` IS NOT 'object' THEN 1
        WHEN json_type(`item`.`value`, '$.id') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.id')) = ''
          OR json_type(`item`.`value`, '$.fileName') IS NOT 'text'
          OR trim(json_extract(`item`.`value`, '$.fileName')) = ''
          OR COALESCE(json_type(`item`.`value`, '$.mimeType'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.driveFileId'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.driveUrl'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.caption'), 'missing') NOT IN ('text', 'null')
          OR COALESCE(json_type(`item`.`value`, '$.capturedAt'), 'missing') NOT IN ('text', 'null')
          OR json_type(`item`.`value`, '$.sourceSystem') IS NOT 'text'
        THEN 1
        ELSE 0
      END = 1
    )
)
SELECT
  `valid_snapshots`.`owner_update_id`,
  json_extract(
    CASE WHEN `document`.`type` = 'object' THEN `document`.`value` ELSE '{}' END,
    '$.id'
  ) AS `resource_id`
FROM `valid_snapshots`
INNER JOIN json_each(`valid_snapshots`.`snapshot`, '$.documents') AS `document`
WHERE `document`.`type` = 'object';
--> statement-breakpoint
DROP TRIGGER IF EXISTS `owner_update_publish_attachment_approval`;
--> statement-breakpoint
CREATE TRIGGER `owner_update_publish_attachment_approval`
AFTER UPDATE OF `status` ON `owner_project_updates`
FOR EACH ROW
WHEN OLD.`status` = 'draft' AND NEW.`status` = 'published'
BEGIN
  UPDATE `daily_log_photos`
  SET
    `review_status` = 'approved',
    `owner_visible` = 1,
    `updated_at` = NEW.`updated_at`
  WHERE `project_id` = NEW.`project_id`
    AND (
      (
        `id` IN (
        SELECT trim(`value`)
        FROM json_each(
          CASE
            WHEN json_valid(NEW.`selected_photo_ids`)
              AND json_type(NEW.`selected_photo_ids`) = 'array'
            THEN NEW.`selected_photo_ids`
            ELSE '[]'
          END
        )
        WHERE `type` = 'text' AND length(trim(`value`)) > 0
        )
        AND `id` NOT IN (
        SELECT `resource_id`
        FROM `owner_update_valid_snapshot_documents`
        WHERE `owner_update_id` = NEW.`id`
        )
      )
      OR (
        `id` IN (
        SELECT `resource_id`
        FROM `owner_update_valid_snapshot_documents`
        WHERE `owner_update_id` = NEW.`id`
        )
        AND `id` NOT IN (
        SELECT trim(`value`)
        FROM json_each(
          CASE
            WHEN json_valid(NEW.`selected_photo_ids`)
              AND json_type(NEW.`selected_photo_ids`) = 'array'
            THEN NEW.`selected_photo_ids`
            ELSE '[]'
          END
        )
        WHERE `type` = 'text' AND length(trim(`value`)) > 0
        )
      )
    );

  DELETE FROM `project_external_resource_grants`
  WHERE `source_owner_update_id` = NEW.`id`
    AND `revoked_at` IS NULL;

  INSERT OR IGNORE INTO `project_external_resource_grants` (
    `id`, `organization_id`, `project_id`, `resource_type`, `resource_id`,
    `source_owner_update_id`, `audience`, `recipient_user_id`, `granted_by`,
    `granted_at`, `revoked_by`, `revoked_at`
  )
  WITH selected_photos AS (
    SELECT trim(`value`) AS `resource_id`
        FROM json_each(
          CASE
            WHEN json_valid(NEW.`selected_photo_ids`)
              AND json_type(NEW.`selected_photo_ids`) = 'array'
            THEN NEW.`selected_photo_ids`
            ELSE '[]'
          END
        )
        WHERE `type` = 'text' AND length(trim(`value`)) > 0
  ), selected_documents AS (
    SELECT `resource_id`
        FROM `owner_update_valid_snapshot_documents`
        WHERE `owner_update_id` = NEW.`id`
  ), attachment_kinds AS (
    SELECT 'photo' AS `resource_type`, `resource_id`
    FROM selected_photos
    WHERE NOT EXISTS (
      SELECT 1 FROM selected_documents
      WHERE selected_documents.resource_id = selected_photos.resource_id
    )
    UNION ALL
    SELECT 'owner_update_document' AS `resource_type`, `resource_id`
    FROM selected_documents
    WHERE NOT EXISTS (
      SELECT 1 FROM selected_photos
      WHERE selected_photos.resource_id = selected_documents.resource_id
    )
  )
  SELECT
    lower(hex(randomblob(16))),
    `projects`.`organization_id`,
    NEW.`project_id`,
    `attachment_kinds`.`resource_type`,
    `daily_log_photos`.`id`,
    NEW.`id`,
    'owner',
    `project_members`.`user_id`,
    COALESCE(
      NEW.`created_by`,
      (
        SELECT `grantor`.`id`
        FROM `users` AS `grantor`
        INNER JOIN `organization_members` AS `grantor_membership`
          ON `grantor_membership`.`user_id` = `grantor`.`id`
          AND `grantor_membership`.`organization_id` = `projects`.`organization_id`
        WHERE `grantor`.`is_active` = 1
          AND `grantor`.`role` NOT IN ('client', 'guest', 'subcontractor', 'supplier')
        ORDER BY `grantor`.`id`
        LIMIT 1
      )
    ),
    NEW.`updated_at`,
    NULL,
    NULL
  FROM attachment_kinds
  INNER JOIN `daily_log_photos`
    ON `daily_log_photos`.`id` = `attachment_kinds`.`resource_id`
    AND `daily_log_photos`.`project_id` = NEW.`project_id`
  INNER JOIN `projects`
    ON `projects`.`id` = NEW.`project_id`
  INNER JOIN `organizations`
    ON `organizations`.`id` = `projects`.`organization_id`
    AND `organizations`.`is_active` = 1
  INNER JOIN `project_members`
    ON `project_members`.`project_id` = `projects`.`id`
    AND `project_members`.`role` IN ('client', 'owner')
  INNER JOIN `users`
    ON `users`.`id` = `project_members`.`user_id`
    AND `users`.`is_active` = 1
  WHERE `daily_log_photos`.`drive_file_id` IS NOT NULL
    AND `daily_log_photos`.`review_status` = 'approved'
    AND `daily_log_photos`.`owner_visible` = 1;
END;
--> statement-breakpoint
DELETE FROM `project_external_resource_grants`
WHERE `source_owner_update_id` IS NOT NULL
  AND `revoked_at` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `project_external_resource_grants` (
  `id`, `organization_id`, `project_id`, `resource_type`, `resource_id`,
  `source_owner_update_id`, `audience`, `recipient_user_id`, `granted_by`,
  `granted_at`, `revoked_by`, `revoked_at`
)
WITH selected_photos AS (
  SELECT
    `owner_project_updates`.`id` AS `source_owner_update_id`,
    `owner_project_updates`.`project_id`,
    trim(`json_each`.`value`) AS `resource_id`,
    `owner_project_updates`.`created_by`,
    `owner_project_updates`.`updated_at`
  FROM `owner_project_updates`, json_each(
    CASE
      WHEN json_valid(`owner_project_updates`.`selected_photo_ids`)
        AND json_type(`owner_project_updates`.`selected_photo_ids`) = 'array'
      THEN `owner_project_updates`.`selected_photo_ids`
      ELSE '[]'
    END
  )
  WHERE `json_each`.`type` = 'text'
    AND length(trim(`json_each`.`value`)) > 0
), selected_documents AS (
  SELECT
    `owner_project_updates`.`id` AS `source_owner_update_id`,
    `owner_project_updates`.`project_id`,
    `owner_update_valid_snapshot_documents`.`resource_id`,
    `owner_project_updates`.`created_by`,
    `owner_project_updates`.`updated_at`
  FROM `owner_project_updates`
  INNER JOIN `owner_update_valid_snapshot_documents`
    ON `owner_update_valid_snapshot_documents`.`owner_update_id` = `owner_project_updates`.`id`
), attachment_kinds AS (
  SELECT 'photo' AS `resource_type`, *
  FROM selected_photos
  WHERE NOT EXISTS (
    SELECT 1 FROM selected_documents
    WHERE selected_documents.source_owner_update_id = selected_photos.source_owner_update_id
      AND selected_documents.resource_id = selected_photos.resource_id
  )
  UNION ALL
  SELECT 'owner_update_document' AS `resource_type`, *
  FROM selected_documents
  WHERE NOT EXISTS (
    SELECT 1 FROM selected_photos
    WHERE selected_photos.source_owner_update_id = selected_documents.source_owner_update_id
      AND selected_photos.resource_id = selected_documents.resource_id
  )
)
SELECT
  lower(hex(randomblob(16))),
  `projects`.`organization_id`,
  `attachment_kinds`.`project_id`,
  `attachment_kinds`.`resource_type`,
  `daily_log_photos`.`id`,
  `attachment_kinds`.`source_owner_update_id`,
  'owner',
  `project_members`.`user_id`,
  COALESCE(
    `attachment_kinds`.`created_by`,
    (
      SELECT `grantor`.`id`
      FROM `users` AS `grantor`
      INNER JOIN `organization_members` AS `grantor_membership`
        ON `grantor_membership`.`user_id` = `grantor`.`id`
        AND `grantor_membership`.`organization_id` = `projects`.`organization_id`
      WHERE `grantor`.`is_active` = 1
        AND `grantor`.`role` NOT IN ('client', 'guest', 'subcontractor', 'supplier')
      ORDER BY `grantor`.`id`
      LIMIT 1
    )
  ),
  `attachment_kinds`.`updated_at`,
  NULL,
  NULL
FROM attachment_kinds
INNER JOIN `owner_project_updates`
  ON `owner_project_updates`.`id` = `attachment_kinds`.`source_owner_update_id`
  AND `owner_project_updates`.`status` IN ('published', 'sent')
INNER JOIN `daily_log_photos`
  ON `daily_log_photos`.`id` = `attachment_kinds`.`resource_id`
  AND `daily_log_photos`.`project_id` = `attachment_kinds`.`project_id`
INNER JOIN `projects`
  ON `projects`.`id` = `attachment_kinds`.`project_id`
INNER JOIN `organizations`
  ON `organizations`.`id` = `projects`.`organization_id`
  AND `organizations`.`is_active` = 1
INNER JOIN `project_members`
  ON `project_members`.`project_id` = `projects`.`id`
  AND `project_members`.`role` IN ('client', 'owner')
INNER JOIN `users`
  ON `users`.`id` = `project_members`.`user_id`
  AND `users`.`is_active` = 1
WHERE `daily_log_photos`.`drive_file_id` IS NOT NULL
  AND `daily_log_photos`.`review_status` = 'approved'
  AND `daily_log_photos`.`owner_visible` = 1;
