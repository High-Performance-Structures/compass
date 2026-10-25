CREATE TABLE `project_external_resource_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `resource_type` text NOT NULL CHECK (`resource_type` IN ('photo', 'owner_update_document')),
  `resource_id` text NOT NULL,
  `audience` text NOT NULL CHECK (`audience` IN ('owner', 'sub_vendor')),
  `recipient_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `granted_by` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `granted_at` text NOT NULL,
  `revoked_by` text REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `revoked_at` text,
  CHECK ((`revoked_at` IS NULL AND `revoked_by` IS NULL) OR (`revoked_at` IS NOT NULL AND `revoked_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_external_resource_grants_active_unique`
  ON `project_external_resource_grants` (`project_id`, `resource_type`, `resource_id`, `audience`, `recipient_user_id`)
  WHERE `revoked_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `project_external_resource_grants_recipient_idx`
  ON `project_external_resource_grants` (`recipient_user_id`, `project_id`, `resource_type`, `resource_id`, `audience`);
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_project_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `projects`
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
    AND `users`.`is_active` = 1
    AND (
      (NEW.`audience` = 'owner' AND `project_members`.`role` IN ('client', 'owner'))
      OR (NEW.`audience` = 'sub_vendor' AND `project_members`.`role` IN ('subcontractor', 'supplier'))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'external resource grants require an active assigned audience recipient');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_resource_guard_insert`
BEFORE INSERT ON `project_external_resource_grants`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM `daily_log_photos`
  WHERE `daily_log_photos`.`id` = NEW.`resource_id`
    AND `daily_log_photos`.`project_id` = NEW.`project_id`
    AND `daily_log_photos`.`review_status` = 'approved'
    AND `daily_log_photos`.`drive_file_id` IS NOT NULL
    AND (
      (
        NEW.`resource_type` = 'photo'
        AND (
          `daily_log_photos`.`mime_type` LIKE 'image/%'
          OR (
            `daily_log_photos`.`mime_type` IS NULL
            AND `daily_log_photos`.`thumbnail_url` IS NOT NULL
          )
        )
      )
      OR (
        NEW.`resource_type` = 'owner_update_document'
        AND (
          (
            `daily_log_photos`.`mime_type` IS NULL
            AND `daily_log_photos`.`thumbnail_url` IS NULL
          )
          OR `daily_log_photos`.`mime_type` NOT LIKE 'image/%'
        )
      )
    )
    AND (
      (NEW.`audience` = 'owner' AND (`daily_log_photos`.`owner_visible` = 1 OR `daily_log_photos`.`public_shareable` = 1))
      OR (NEW.`audience` = 'sub_vendor' AND (`daily_log_photos`.`sub_vendor_visible` = 1 OR `daily_log_photos`.`public_shareable` = 1))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'external resource grant must target an approved audience-visible stored resource');
END;
--> statement-breakpoint
CREATE TRIGGER `project_external_resource_grants_identity_immutable`
BEFORE UPDATE ON `project_external_resource_grants`
FOR EACH ROW
WHEN NEW.`organization_id` <> OLD.`organization_id`
  OR NEW.`project_id` <> OLD.`project_id`
  OR NEW.`resource_type` <> OLD.`resource_type`
  OR NEW.`resource_id` <> OLD.`resource_id`
  OR NEW.`audience` <> OLD.`audience`
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
