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
        json_valid(COALESCE(NEW.`selected_photo_ids`, '[]'))
        AND `id` IN (
          SELECT value
          FROM json_each(COALESCE(NEW.`selected_photo_ids`, '[]'))
        )
      )
      OR (
        json_valid(COALESCE(NEW.`schedule_snapshot`, '{}'))
        AND `id` IN (
          SELECT json_extract(value, '$.id')
          FROM json_each(COALESCE(NEW.`schedule_snapshot`, '{}'), '$.documents')
        )
      )
    );
END;
--> statement-breakpoint
