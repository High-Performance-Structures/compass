CREATE TABLE `project_external_resource_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `resource_type` text NOT NULL CHECK (`resource_type` IN ('audience_file', 'photo', 'video')),
  `resource_id` text NOT NULL,
  `recipient_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `granted_by` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `granted_at` text NOT NULL,
  `revoked_by` text REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `revoked_at` text,
  CHECK (
    (`revoked_at` IS NULL AND `revoked_by` IS NULL)
    OR (`revoked_at` IS NOT NULL AND `revoked_by` IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_external_resource_grants_active_unique`
  ON `project_external_resource_grants` (`project_id`, `resource_type`, `resource_id`, `recipient_user_id`)
  WHERE `revoked_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `project_external_resource_grants_recipient_idx`
  ON `project_external_resource_grants` (`recipient_user_id`, `project_id`, `resource_type`, `resource_id`);
--> statement-breakpoint
CREATE TABLE `project_external_resource_grant_events` (
  `id` text PRIMARY KEY NOT NULL,
  `grant_id` text NOT NULL REFERENCES `project_external_resource_grants`(`id`) ON DELETE CASCADE,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `action` text NOT NULL CHECK (`action` IN ('granted', 'revoked')),
  `actor_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_external_resource_grant_events_project_idx`
  ON `project_external_resource_grant_events` (`project_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `project_external_resource_grant_events_grant_idx`
  ON `project_external_resource_grant_events` (`grant_id`, `occurred_at`);
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_project_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM `projects`
  WHERE `projects`.`id` = NEW.`project_id`
    AND `projects`.`organization_id` = NEW.`organization_id`
)
BEGIN
  SELECT RAISE(ABORT, 'external resource grants must remain project and organization scoped');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_recipient_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM `project_members`
  INNER JOIN `users` ON `users`.`id` = `project_members`.`user_id`
  WHERE `project_members`.`project_id` = NEW.`project_id`
    AND `project_members`.`user_id` = NEW.`recipient_user_id`
    AND `project_members`.`role` IN ('client', 'owner', 'subcontractor', 'supplier')
    AND `users`.`is_active` = 1
)
BEGIN
  SELECT RAISE(ABORT, 'external resource grants require an active assigned external recipient');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_audience_file_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NEW.`resource_type` = 'audience_file'
  AND NOT EXISTS (
    SELECT 1
    FROM `project_audience_files`
    WHERE `project_audience_files`.`id` = NEW.`resource_id`
      AND `project_audience_files`.`organization_id` = NEW.`organization_id`
      AND `project_audience_files`.`project_id` = NEW.`project_id`
      AND `project_audience_files`.`upload_status` = 'uploaded'
  )
BEGIN
  SELECT RAISE(ABORT, 'external resource grant must target an uploaded project file');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_photo_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NEW.`resource_type` = 'photo'
  AND NOT EXISTS (
    SELECT 1
    FROM `daily_log_photos`
    WHERE `daily_log_photos`.`id` = NEW.`resource_id`
      AND `daily_log_photos`.`project_id` = NEW.`project_id`
      AND `daily_log_photos`.`review_status` = 'approved'
      AND `daily_log_photos`.`drive_file_id` IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'external resource grant must target an approved stored project photo');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_video_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NEW.`resource_type` = 'video'
  AND NOT EXISTS (
    SELECT 1
    FROM `project_videos`
    WHERE `project_videos`.`id` = NEW.`resource_id`
      AND `project_videos`.`organization_id` = NEW.`organization_id`
      AND `project_videos`.`project_id` = NEW.`project_id`
      AND `project_videos`.`publish_status` = 'published'
      AND `project_videos`.`deleted_at` IS NULL
      AND `project_videos`.`drive_file_id` IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'external resource grant must target a published stored project video');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_identity_immutable`
BEFORE UPDATE ON `project_external_resource_grants`
FOR EACH ROW
WHEN NEW.`organization_id` <> OLD.`organization_id`
  OR NEW.`project_id` <> OLD.`project_id`
  OR NEW.`resource_type` <> OLD.`resource_type`
  OR NEW.`resource_id` <> OLD.`resource_id`
  OR NEW.`recipient_user_id` <> OLD.`recipient_user_id`
  OR NEW.`granted_by` <> OLD.`granted_by`
  OR NEW.`granted_at` <> OLD.`granted_at`
BEGIN
  SELECT RAISE(ABORT, 'external resource grant identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_revocation_guard`
BEFORE UPDATE OF `revoked_by`, `revoked_at` ON `project_external_resource_grants`
FOR EACH ROW
WHEN OLD.`revoked_at` IS NOT NULL
  OR NEW.`revoked_at` IS NULL
  OR NEW.`revoked_by` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'external resource grants may only be revoked once');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_audit_granted`
AFTER INSERT ON `project_external_resource_grants`
FOR EACH ROW
BEGIN
  INSERT INTO `project_external_resource_grant_events` (
    `id`, `grant_id`, `organization_id`, `project_id`, `action`, `actor_user_id`, `occurred_at`
  ) VALUES (
    lower(hex(randomblob(16))), NEW.`id`, NEW.`organization_id`, NEW.`project_id`, 'granted', NEW.`granted_by`, NEW.`granted_at`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_audit_revoked`
AFTER UPDATE OF `revoked_by`, `revoked_at` ON `project_external_resource_grants`
FOR EACH ROW
WHEN OLD.`revoked_at` IS NULL AND NEW.`revoked_at` IS NOT NULL
BEGIN
  INSERT INTO `project_external_resource_grant_events` (
    `id`, `grant_id`, `organization_id`, `project_id`, `action`, `actor_user_id`, `occurred_at`
  ) VALUES (
    lower(hex(randomblob(16))), NEW.`id`, NEW.`organization_id`, NEW.`project_id`, 'revoked', NEW.`revoked_by`, NEW.`revoked_at`
  );
END;
