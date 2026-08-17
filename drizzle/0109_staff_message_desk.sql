CREATE TABLE `staff_message_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `source_type` text NOT NULL CHECK (`source_type` IN ('call', 'message')),
  `goto_inbound_event_id` text REFERENCES `goto_inbound_events`(`id`) ON DELETE SET NULL,
  `caller_name` text NOT NULL,
  `caller_company` text,
  `caller_phone` text,
  `caller_email` text,
  `subject` text NOT NULL,
  `body` text NOT NULL,
  `status` text NOT NULL DEFAULT 'New' CHECK (`status` IN ('New', 'Assigned', 'In Progress', 'Waiting', 'Completed')),
  `assignee_user_id` text NOT NULL REFERENCES `users`(`id`),
  `follow_up_due_date` text,
  `completion_outcome` text,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `completed_at` text,
  `deleted_at` text,
  `deleted_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_message_records_goto_event_unique`
  ON `staff_message_records` (`goto_inbound_event_id`);
--> statement-breakpoint
CREATE INDEX `staff_message_records_org_status_idx`
  ON `staff_message_records` (`organization_id`, `status`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `staff_message_records_assignee_status_idx`
  ON `staff_message_records` (`assignee_user_id`, `status`, `updated_at`);
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_assignee_guard_insert`
BEFORE INSERT ON `staff_message_records`
BEGIN
  SELECT RAISE(ABORT, 'Staff message records require an active internal staff assignee')
  WHERE NOT EXISTS (
    SELECT 1
    FROM `users` AS u
    INNER JOIN `organization_members` AS om ON om.user_id = u.id
    INNER JOIN `organizations` AS o ON o.id = om.organization_id
    WHERE u.id = NEW.assignee_user_id
      AND om.organization_id = NEW.organization_id
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
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_assignee_guard_update`
BEFORE UPDATE OF `assignee_user_id`, `organization_id` ON `staff_message_records`
BEGIN
  SELECT RAISE(ABORT, 'Staff message records require an active internal staff assignee')
  WHERE NOT EXISTS (
    SELECT 1
    FROM `users` AS u
    INNER JOIN `organization_members` AS om ON om.user_id = u.id
    INNER JOIN `organizations` AS o ON o.id = om.organization_id
    WHERE u.id = NEW.assignee_user_id
      AND om.organization_id = NEW.organization_id
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
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_user_active_guard`
BEFORE UPDATE OF `is_active` ON `users`
WHEN NEW.is_active = 0
BEGIN
  SELECT RAISE(ABORT, 'Reassign active staff message records before deactivating a user')
  WHERE EXISTS (
    SELECT 1
    FROM `staff_message_records`
    WHERE `staff_message_records`.`assignee_user_id` = NEW.id
      AND `staff_message_records`.`deleted_at` IS NULL
  );
END;
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_member_role_guard`
BEFORE UPDATE OF `role`, `organization_id`, `user_id` ON `organization_members`
BEGIN
  SELECT RAISE(ABORT, 'Reassign active staff message records before changing staff membership')
  WHERE EXISTS (
    SELECT 1
    FROM `staff_message_records` AS smr
    WHERE smr.assignee_user_id = NEW.user_id
      AND smr.organization_id = OLD.organization_id
      AND smr.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `users` AS u
    INNER JOIN `organizations` AS o ON o.id = NEW.organization_id
    WHERE u.id = NEW.user_id
      AND NEW.organization_id = OLD.organization_id
      AND u.is_active = 1
      AND o.is_active = 1
      AND o.type = 'internal'
      AND NEW.role IN (
        'admin', 'secondary_admin', 'executive', 'project_manager',
        'project_administrator', 'assistant_project_manager', 'accounting',
        'office_manager', 'office', 'field_superintendent', 'field_crew',
        'architectural_designer', 'drafter', 'lead_estimator',
        'assistant_estimator', 'coordinator', 'field'
      )
  );
END;
--> statement-breakpoint
CREATE TRIGGER `staff_message_record_organization_active_guard`
BEFORE UPDATE OF `is_active`, `type` ON `organizations`
WHEN NEW.is_active = 0 OR NEW.type <> 'internal'
BEGIN
  SELECT RAISE(ABORT, 'Reassign active staff message records before deactivating an organization')
  WHERE EXISTS (
    SELECT 1
    FROM `staff_message_records`
    WHERE `staff_message_records`.`organization_id` = NEW.id
      AND `staff_message_records`.`deleted_at` IS NULL
  );
END;
--> statement-breakpoint
CREATE TABLE `staff_message_history` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE CASCADE,
  `record_id` text NOT NULL REFERENCES `staff_message_records`(`id`) ON DELETE CASCADE,
  `actor_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `action` text NOT NULL,
  `from_status` text,
  `to_status` text,
  `from_assignee_user_id` text,
  `to_assignee_user_id` text,
  `note` text,
  `metadata` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_message_history_record_created_idx`
  ON `staff_message_history` (`record_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `staff_message_history_org_created_idx`
  ON `staff_message_history` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE TRIGGER `staff_message_history_no_update`
BEFORE UPDATE ON `staff_message_history`
BEGIN
  SELECT RAISE(ABORT, 'Staff message history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `staff_message_history_no_delete`
BEFORE DELETE ON `staff_message_history`
BEGIN
  SELECT RAISE(ABORT, 'Staff message history is immutable');
END;
