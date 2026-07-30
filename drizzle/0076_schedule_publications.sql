CREATE TABLE `schedule_publications` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `snapshot_data` text NOT NULL,
  `change_reason` text NOT NULL,
  `published_by` text,
  `published_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_publications_project_published`
  ON `schedule_publications` (`project_id`, `published_at`);
--> statement-breakpoint
INSERT INTO `schedule_publications` (
  `id`,
  `project_id`,
  `snapshot_data`,
  `change_reason`,
  `published_by`,
  `published_at`
)
SELECT
  'initial-schedule-publication-' || p.`id`,
  p.`id`,
  json_object(
    'version', 1,
    'tasks', json(COALESCE((
      SELECT json_group_array(json_object(
        'id', t.`id`,
        'projectId', t.`project_id`,
        'title', t.`title`,
        'startDate', t.`start_date`,
        'workdays', t.`workdays`,
        'endDateCalculated', t.`end_date_calculated`,
        'phase', t.`phase`,
        'displayColor', t.`display_color`,
        'status', t.`status`,
        'isCriticalPath', json(CASE WHEN t.`is_critical_path` = 1 THEN 'true' ELSE 'false' END),
        'isMilestone', json(CASE WHEN t.`is_milestone` = 1 THEN 'true' ELSE 'false' END),
        'percentComplete', t.`percent_complete`,
        'assignedTo', t.`assigned_to`,
        'sortOrder', t.`sort_order`,
        'createdAt', t.`created_at`,
        'updatedAt', t.`updated_at`
      ))
      FROM `schedule_tasks` t
      WHERE t.`project_id` = p.`id`
      ORDER BY t.`sort_order`
    ), '[]')),
    'dependencies', json(COALESCE((
      SELECT json_group_array(json_object(
        'id', d.`id`,
        'predecessorId', d.`predecessor_id`,
        'successorId', d.`successor_id`,
        'type', d.`type`,
        'lagDays', d.`lag_days`
      ))
      FROM `task_dependencies` d
      JOIN `schedule_tasks` successor
        ON successor.`id` = d.`successor_id`
      WHERE successor.`project_id` = p.`id`
    ), '[]')),
    'exceptions', json(COALESCE((
      SELECT json_group_array(json_object(
        'id', e.`id`,
        'projectId', e.`project_id`,
        'title', e.`title`,
        'startDate', e.`start_date`,
        'endDate', e.`end_date`,
        'type', e.`type`,
        'category', e.`category`,
        'recurrence', e.`recurrence`,
        'notes', e.`notes`,
        'createdAt', e.`created_at`,
        'updatedAt', e.`updated_at`
      ))
      FROM `workday_exceptions` e
      WHERE e.`project_id` = p.`id`
      ORDER BY e.`start_date`
    ), '[]'))
  ),
  'Initial controlled schedule snapshot.',
  (
    SELECT om.`user_id`
    FROM `organization_members` om
    WHERE om.`organization_id` = p.`organization_id`
    ORDER BY
      CASE WHEN om.`role` IN ('admin', 'super_admin') THEN 0 ELSE 1 END,
      om.`joined_at`
    LIMIT 1
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `projects` p
WHERE p.`organization_id` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `organization_members` om
    WHERE om.`organization_id` = p.`organization_id`
  );
