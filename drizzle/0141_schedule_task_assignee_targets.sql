-- Make the target of each assignment explicit while preserving imported
-- participant provenance and the legacy schedule_tasks.assigned_user_id.
ALTER TABLE `schedule_task_assignees`
  ADD `assigned_user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `schedule_task_assignees`
  ADD `project_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint
-- Backfill targets for assignments created before the denormalized columns.
-- The updates are idempotent and preserve any explicit target already present.
UPDATE `schedule_task_assignees`
SET `assigned_user_id` = (
  SELECT `user_id`
  FROM `project_source_record_participants`
  WHERE `project_source_record_participants`.`id` = `schedule_task_assignees`.`participant_id`
)
WHERE `assigned_user_id` IS NULL;
--> statement-breakpoint
UPDATE `schedule_task_assignees`
SET `project_contact_id` = (
  SELECT `project_contact_id`
  FROM `project_source_record_participants`
  WHERE `project_source_record_participants`.`id` = `schedule_task_assignees`.`participant_id`
)
WHERE `project_contact_id` IS NULL;
--> statement-breakpoint
-- Older rows were unique by participant, so two provenance records can resolve
-- to the same user or contact. Keep the lexically first explicit target and
-- fail closed on later duplicates without deleting their source provenance.
UPDATE `schedule_task_assignees`
SET `assigned_user_id` = NULL
WHERE `assigned_user_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `schedule_task_assignees` AS `earlier`
    WHERE `earlier`.`schedule_task_id` = `schedule_task_assignees`.`schedule_task_id`
      AND `earlier`.`assigned_user_id` = `schedule_task_assignees`.`assigned_user_id`
      AND `earlier`.`id` < `schedule_task_assignees`.`id`
  );
--> statement-breakpoint
UPDATE `schedule_task_assignees`
SET `project_contact_id` = NULL
WHERE `project_contact_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `schedule_task_assignees` AS `earlier`
    WHERE `earlier`.`schedule_task_id` = `schedule_task_assignees`.`schedule_task_id`
      AND `earlier`.`project_contact_id` = `schedule_task_assignees`.`project_contact_id`
      AND `earlier`.`id` < `schedule_task_assignees`.`id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_task_assignees_task_user_unique`
  ON `schedule_task_assignees` (`schedule_task_id`, `assigned_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_task_assignees_task_contact_unique`
  ON `schedule_task_assignees` (`schedule_task_id`, `project_contact_id`);
