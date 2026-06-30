UPDATE `project_role_assignments`
SET
  `role_id` = 'architectural-designer',
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `role_id` = 'design-estimating';
