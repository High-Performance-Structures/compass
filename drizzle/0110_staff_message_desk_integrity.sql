DROP TRIGGER IF EXISTS `staff_message_record_member_role_guard`;
--> statement-breakpoint
DROP INDEX IF EXISTS `staff_message_records_goto_event_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_message_records_goto_event_active_unique`
  ON `staff_message_records` (`goto_inbound_event_id`)
  WHERE `goto_inbound_event_id` IS NOT NULL
    AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_member_update_guard`
BEFORE UPDATE OF `role`, `organization_id`, `user_id` ON `organization_members`
BEGIN
  SELECT RAISE(ABORT, 'Reassign active staff message records before changing staff membership')
  WHERE EXISTS (
    SELECT 1
    FROM `staff_message_records` AS smr
    WHERE smr.assignee_user_id = OLD.user_id
      AND smr.organization_id = OLD.organization_id
      AND smr.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `users` AS u
    INNER JOIN `organization_members` AS om ON om.user_id = OLD.user_id
    INNER JOIN `organizations` AS o ON o.id = om.organization_id
    WHERE u.id = OLD.user_id
      AND om.organization_id = OLD.organization_id
      AND u.is_active = 1
      AND o.is_active = 1
      AND o.type = 'internal'
      AND (
        om.id <> OLD.id
        OR (
          NEW.user_id = OLD.user_id
          AND NEW.organization_id = OLD.organization_id
          AND NEW.role IN (
            'admin', 'secondary_admin', 'executive', 'project_manager',
            'project_administrator', 'assistant_project_manager', 'accounting',
            'office_manager', 'office', 'field_superintendent', 'field_crew',
            'architectural_designer', 'drafter', 'lead_estimator',
            'assistant_estimator', 'coordinator', 'field'
          )
        )
      )
  );
END;
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_member_delete_guard`
BEFORE DELETE ON `organization_members`
BEGIN
  SELECT RAISE(ABORT, 'Reassign active staff message records before changing staff membership')
  WHERE EXISTS (
    SELECT 1
    FROM `staff_message_records` AS smr
    WHERE smr.assignee_user_id = OLD.user_id
      AND smr.organization_id = OLD.organization_id
      AND smr.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `users` AS u
    INNER JOIN `organization_members` AS om ON om.user_id = OLD.user_id
    INNER JOIN `organizations` AS o ON o.id = om.organization_id
    WHERE u.id = OLD.user_id
      AND om.organization_id = OLD.organization_id
      AND om.id <> OLD.id
      AND u.is_active = 1
      AND o.is_active = 1
      AND o.type = 'internal'
      AND om.role IN (
        'admin', 'secondary_admin', 'executive', 'project_manager',
        'project_administrator', 'assistant_project_manager', 'accounting',
        'office_manager', 'office', 'field_superintendent', 'field_crew',
        'architectural_designer', 'drafter', 'lead_estimator',
        'assistant_estimator', 'coordinator', 'field'
      )
  );
END;
