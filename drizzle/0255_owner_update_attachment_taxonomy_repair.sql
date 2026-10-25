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
        json_valid(NEW.`selected_photo_ids`)
        AND json_type(NEW.`selected_photo_ids`) = 'array'
        AND `id` IN (
          SELECT trim(`value`)
          FROM json_each(NEW.`selected_photo_ids`)
          WHERE `type` = 'text' AND length(trim(`value`)) > 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE
              WHEN json_valid(NEW.`schedule_snapshot`)
                AND json_type(NEW.`schedule_snapshot`) = 'object'
                AND json_extract(NEW.`schedule_snapshot`, '$.version') = 2
                AND json_type(NEW.`schedule_snapshot`, '$.completedScheduleItems') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.lookAheadScheduleItems') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.todos') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.documents') = 'array'
              THEN NEW.`schedule_snapshot`
              ELSE '{"documents":[]}'
            END,
            '$.documents'
          )
          WHERE `type` = 'object'
            AND json_type(`value`, '$.id') = 'text'
            AND length(trim(json_extract(`value`, '$.id'))) > 0
            AND json_type(`value`, '$.fileName') = 'text'
            AND length(trim(json_extract(`value`, '$.fileName'))) > 0
            AND json_type(`value`, '$.mimeType') IN ('text', 'null')
            AND json_type(`value`, '$.driveFileId') IN ('text', 'null')
            AND json_type(`value`, '$.driveUrl') IN ('text', 'null')
            AND json_type(`value`, '$.caption') IN ('text', 'null')
            AND json_type(`value`, '$.capturedAt') IN ('text', 'null')
            AND json_type(`value`, '$.sourceSystem') = 'text'
            AND json_extract(`value`, '$.id') = `id`
        )
      )
      OR (
        `id` IN (
          SELECT json_extract(`value`, '$.id')
          FROM json_each(
            CASE
              WHEN json_valid(NEW.`schedule_snapshot`)
                AND json_type(NEW.`schedule_snapshot`) = 'object'
                AND json_extract(NEW.`schedule_snapshot`, '$.version') = 2
                AND json_type(NEW.`schedule_snapshot`, '$.completedScheduleItems') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.lookAheadScheduleItems') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.todos') = 'array'
                AND json_type(NEW.`schedule_snapshot`, '$.documents') = 'array'
              THEN NEW.`schedule_snapshot`
              ELSE '{"documents":[]}'
            END,
            '$.documents'
          )
          WHERE `type` = 'object'
            AND json_type(`value`, '$.id') = 'text'
            AND length(trim(json_extract(`value`, '$.id'))) > 0
            AND json_type(`value`, '$.fileName') = 'text'
            AND length(trim(json_extract(`value`, '$.fileName'))) > 0
            AND json_type(`value`, '$.mimeType') IN ('text', 'null')
            AND json_type(`value`, '$.driveFileId') IN ('text', 'null')
            AND json_type(`value`, '$.driveUrl') IN ('text', 'null')
            AND json_type(`value`, '$.caption') IN ('text', 'null')
            AND json_type(`value`, '$.capturedAt') IN ('text', 'null')
            AND json_type(`value`, '$.sourceSystem') = 'text'
        )
        AND NOT (
          json_valid(NEW.`selected_photo_ids`)
        AND json_type(NEW.`selected_photo_ids`) = 'array'
          AND `id` IN (
            SELECT trim(`value`)
            FROM json_each(NEW.`selected_photo_ids`)
            WHERE `type` = 'text' AND length(trim(`value`)) > 0
          )
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
    SELECT json_extract(`value`, '$.id') AS `resource_id`
    FROM json_each(
      CASE
        WHEN json_valid(NEW.`schedule_snapshot`)
                AND json_type(NEW.`schedule_snapshot`) = 'object'
          AND json_extract(NEW.`schedule_snapshot`, '$.version') = 2
          AND json_type(NEW.`schedule_snapshot`, '$.documents') = 'array'
        THEN NEW.`schedule_snapshot`
        ELSE '{"documents":[]}'
      END,
      '$.documents'
    )
    WHERE `type` = 'object'
      AND json_type(`value`, '$.id') = 'text'
      AND length(trim(json_extract(`value`, '$.id'))) > 0
      AND json_type(`value`, '$.fileName') = 'text'
      AND length(trim(json_extract(`value`, '$.fileName'))) > 0
      AND json_type(`value`, '$.mimeType') IN ('text', 'null')
      AND json_type(`value`, '$.driveFileId') IN ('text', 'null')
      AND json_type(`value`, '$.driveUrl') IN ('text', 'null')
      AND json_type(`value`, '$.caption') IN ('text', 'null')
      AND json_type(`value`, '$.capturedAt') IN ('text', 'null')
      AND json_type(`value`, '$.sourceSystem') = 'text'
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
    json_extract(`json_each`.`value`, '$.id') AS `resource_id`,
    `owner_project_updates`.`created_by`,
    `owner_project_updates`.`updated_at`
  FROM `owner_project_updates`, json_each(
    CASE
      WHEN json_valid(`owner_project_updates`.`schedule_snapshot`)
        AND json_type(`owner_project_updates`.`schedule_snapshot`) = 'object'
        AND json_extract(`owner_project_updates`.`schedule_snapshot`, '$.version') = 2
        AND json_type(`owner_project_updates`.`schedule_snapshot`, '$.completedScheduleItems') = 'array'
        AND json_type(`owner_project_updates`.`schedule_snapshot`, '$.lookAheadScheduleItems') = 'array'
        AND json_type(`owner_project_updates`.`schedule_snapshot`, '$.todos') = 'array'
        AND json_type(`owner_project_updates`.`schedule_snapshot`, '$.documents') = 'array'
      THEN `owner_project_updates`.`schedule_snapshot`
      ELSE '{"documents":[]}'
    END,
    '$.documents'
  )
  WHERE `json_each`.`type` = 'object'
    AND json_type(`json_each`.`value`, '$.id') = 'text'
    AND length(trim(json_extract(`json_each`.`value`, '$.id'))) > 0
    AND json_type(`json_each`.`value`, '$.fileName') = 'text'
    AND length(trim(json_extract(`json_each`.`value`, '$.fileName'))) > 0
    AND json_type(`json_each`.`value`, '$.mimeType') IN ('text', 'null')
    AND json_type(`json_each`.`value`, '$.driveFileId') IN ('text', 'null')
    AND json_type(`json_each`.`value`, '$.driveUrl') IN ('text', 'null')
    AND json_type(`json_each`.`value`, '$.caption') IN ('text', 'null')
    AND json_type(`json_each`.`value`, '$.capturedAt') IN ('text', 'null')
    AND json_type(`json_each`.`value`, '$.sourceSystem') = 'text'
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
