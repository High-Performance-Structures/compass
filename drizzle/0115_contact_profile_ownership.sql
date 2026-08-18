ALTER TABLE `users` ADD `phone` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `address` text;
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `address` text;
--> statement-breakpoint

-- Native project intake historically saved customer and assignee details on
-- separate records without creating the project-scoped contact links. Repair
-- only projects proven to have come through that intake path.
WITH `native_projects` AS (
  SELECT DISTINCT
    p.`id`,
    p.`organization_id`,
    p.`client_name`,
    p.`project_manager`,
    p.`created_at`
  FROM `projects` p
  INNER JOIN `project_operations` o
    ON o.`project_id` = p.`id`
   AND o.`source_system` = 'compass_project_intake'
),
`matched_customers` AS (
  SELECT
    n.`id` AS `project_id`,
    n.`created_at` AS `project_created_at`,
    c.`id` AS `customer_id`,
    c.`name`,
    c.`company`,
    c.`email`,
    c.`phone`,
    c.`address`,
    ROW_NUMBER() OVER (
      PARTITION BY n.`id`
      ORDER BY c.`created_at`, c.`id`
    ) AS `match_rank`
  FROM `native_projects` n
  INNER JOIN `customers` c
    ON c.`organization_id` = n.`organization_id`
   AND lower(trim(c.`name`)) = lower(trim(n.`client_name`))
  WHERE n.`client_name` IS NOT NULL
    AND trim(n.`client_name`) <> ''
)
INSERT INTO `project_contacts` (
  `id`, `project_id`, `contact_type`, `source_system`, `source_record_id`,
  `source_entity_type`, `source_entity_id`, `display_name`, `company_name`,
  `role`, `trade`, `csi_division`, `csi_division_name`, `primary_cost_code`,
  `email`, `phone`, `address`, `notes`, `owner_portal_visible`,
  `sub_vendor_portal_visible`, `internal_visible`, `primary_contact`, `active`,
  `sort_order`, `sync_status`, `last_synced_at`, `created_at`, `updated_at`
)
SELECT
  'intake-owner:' || m.`project_id`,
  m.`project_id`,
  'owner',
  'customer_directory',
  m.`customer_id`,
  'customer',
  m.`customer_id`,
  m.`name`,
  m.`company`,
  'Owner / Client',
  NULL,
  NULL,
  NULL,
  NULL,
  m.`email`,
  m.`phone`,
  m.`address`,
  'Linked automatically from Compass project intake.',
  1,
  0,
  1,
  1,
  1,
  100,
  'manual',
  NULL,
  m.`project_created_at`,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `matched_customers` m
WHERE m.`match_rank` = 1
  AND NOT EXISTS (
    SELECT 1
    FROM `project_contacts` existing
    WHERE existing.`project_id` = m.`project_id`
      AND existing.`active` = 1
      AND existing.`contact_type` = 'owner'
      AND (
        (existing.`source_entity_type` = 'customer'
          AND existing.`source_entity_id` = m.`customer_id`)
        OR (m.`email` IS NOT NULL AND trim(m.`email`) <> ''
          AND lower(trim(existing.`email`)) = lower(trim(m.`email`)))
        OR lower(trim(existing.`display_name`)) = lower(trim(m.`name`))
      )
  );
--> statement-breakpoint

-- If an older native intake has no matching customer-directory record, keep
-- the recorded client visible as a manual owner contact instead of losing it.
WITH `native_projects` AS (
  SELECT DISTINCT
    p.`id`,
    p.`client_name`,
    p.`created_at`
  FROM `projects` p
  INNER JOIN `project_operations` o
    ON o.`project_id` = p.`id`
   AND o.`source_system` = 'compass_project_intake'
)
INSERT INTO `project_contacts` (
  `id`, `project_id`, `contact_type`, `source_system`, `source_record_id`,
  `source_entity_type`, `source_entity_id`, `display_name`, `company_name`,
  `role`, `trade`, `csi_division`, `csi_division_name`, `primary_cost_code`,
  `email`, `phone`, `address`, `notes`, `owner_portal_visible`,
  `sub_vendor_portal_visible`, `internal_visible`, `primary_contact`, `active`,
  `sort_order`, `sync_status`, `last_synced_at`, `created_at`, `updated_at`
)
SELECT
  'intake-owner-manual:' || n.`id`,
  n.`id`,
  'owner',
  'compass_project_intake',
  n.`id`,
  'manual',
  NULL,
  trim(n.`client_name`),
  NULL,
  'Owner / Client',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'Recovered from the project intake client name; directory details need review.',
  1,
  0,
  1,
  1,
  1,
  100,
  'manual',
  NULL,
  n.`created_at`,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `native_projects` n
WHERE n.`client_name` IS NOT NULL
  AND trim(n.`client_name`) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM `project_contacts` existing
    WHERE existing.`project_id` = n.`id`
      AND existing.`active` = 1
      AND existing.`contact_type` = 'owner'
  );
--> statement-breakpoint

WITH `matched_assignees` AS (
  SELECT DISTINCT
    p.`id` AS `project_id`,
    p.`created_at` AS `project_created_at`,
    u.`id` AS `user_id`,
    COALESCE(
      NULLIF(trim(u.`display_name`), ''),
      NULLIF(trim(COALESCE(u.`first_name`, '') || ' ' || COALESCE(u.`last_name`, '')), ''),
      u.`email`
    ) AS `display_name`,
    u.`email`,
    u.`phone`,
    u.`address`
  FROM `projects` p
  INNER JOIN `project_operations` o
    ON o.`project_id` = p.`id`
   AND o.`source_system` = 'compass_project_intake'
  INNER JOIN `organization_members` om
    ON om.`organization_id` = p.`organization_id`
  INNER JOIN `users` u
    ON u.`id` = om.`user_id`
   AND u.`is_active` = 1
  WHERE p.`project_manager` IS NOT NULL
    AND trim(p.`project_manager`) <> ''
    AND lower(trim(p.`project_manager`)) = lower(trim(COALESCE(
      NULLIF(trim(u.`display_name`), ''),
      NULLIF(trim(COALESCE(u.`first_name`, '') || ' ' || COALESCE(u.`last_name`, '')), ''),
      u.`email`
    )))
)
INSERT INTO `project_contacts` (
  `id`, `project_id`, `contact_type`, `source_system`, `source_record_id`,
  `source_entity_type`, `source_entity_id`, `display_name`, `company_name`,
  `role`, `trade`, `csi_division`, `csi_division_name`, `primary_cost_code`,
  `email`, `phone`, `address`, `notes`, `owner_portal_visible`,
  `sub_vendor_portal_visible`, `internal_visible`, `primary_contact`, `active`,
  `sort_order`, `sync_status`, `last_synced_at`, `created_at`, `updated_at`
)
SELECT
  'intake-internal:' || m.`project_id` || ':' || m.`user_id`,
  m.`project_id`,
  'internal',
  'organization_directory',
  m.`user_id`,
  'user',
  m.`user_id`,
  m.`display_name`,
  NULL,
  'Project manager',
  NULL,
  NULL,
  NULL,
  NULL,
  m.`email`,
  m.`phone`,
  m.`address`,
  'Linked automatically from the Compass project intake assignment.',
  1,
  1,
  1,
  1,
  1,
  200,
  'synced',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  m.`project_created_at`,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `matched_assignees` m
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_contacts` existing
  WHERE existing.`project_id` = m.`project_id`
    AND existing.`active` = 1
    AND existing.`contact_type` = 'internal'
    AND (
      (existing.`source_entity_type` = 'user'
        AND existing.`source_entity_id` = m.`user_id`)
      OR lower(trim(existing.`email`)) = lower(trim(m.`email`))
      OR lower(trim(existing.`display_name`)) = lower(trim(m.`display_name`))
    )
);
--> statement-breakpoint

WITH `matched_assignees` AS (
  SELECT DISTINCT
    p.`id` AS `project_id`,
    p.`created_at` AS `project_created_at`,
    u.`id` AS `user_id`
  FROM `projects` p
  INNER JOIN `project_operations` o
    ON o.`project_id` = p.`id`
   AND o.`source_system` = 'compass_project_intake'
  INNER JOIN `organization_members` om
    ON om.`organization_id` = p.`organization_id`
  INNER JOIN `users` u
    ON u.`id` = om.`user_id`
   AND u.`is_active` = 1
  WHERE p.`project_manager` IS NOT NULL
    AND trim(p.`project_manager`) <> ''
    AND lower(trim(p.`project_manager`)) = lower(trim(COALESCE(
      NULLIF(trim(u.`display_name`), ''),
      NULLIF(trim(COALESCE(u.`first_name`, '') || ' ' || COALESCE(u.`last_name`, '')), ''),
      u.`email`
    )))
)
INSERT INTO `project_members` (
  `id`, `project_id`, `user_id`, `role`, `assigned_at`
)
SELECT
  'intake-member:' || m.`project_id` || ':' || m.`user_id`,
  m.`project_id`,
  m.`user_id`,
  'project-manager',
  m.`project_created_at`
FROM `matched_assignees` m
WHERE NOT EXISTS (
  SELECT 1
  FROM `project_members` existing
  WHERE existing.`project_id` = m.`project_id`
    AND existing.`user_id` = m.`user_id`
);
--> statement-breakpoint

UPDATE `project_contacts`
SET `address` = (
  SELECT c.`address`
  FROM `customers` c
  WHERE c.`id` = `project_contacts`.`source_entity_id`
)
WHERE `source_entity_type` = 'customer'
  AND `source_entity_id` IS NOT NULL
  AND (`address` IS NULL OR trim(`address`) = '');
--> statement-breakpoint

UPDATE `project_contacts`
SET `address` = (
  SELECT v.`address`
  FROM `vendors` v
  WHERE v.`id` = `project_contacts`.`source_entity_id`
)
WHERE `source_entity_type` = 'vendor'
  AND `source_entity_id` IS NOT NULL
  AND (`address` IS NULL OR trim(`address`) = '');
--> statement-breakpoint

-- Preserve the staff-maintained identity details when an existing invited
-- contact has already activated their Compass account. Future edits come from
-- Account Settings and synchronize back to these linked directory records.
UPDATE `users`
SET
  `phone` = COALESCE(
    NULLIF(trim(`users`.`phone`), ''),
    (
      SELECT NULLIF(trim(pc.`phone`), '')
      FROM `project_access_invitations` invitation
      INNER JOIN `project_contacts` pc
        ON pc.`id` = invitation.`project_contact_id`
      WHERE invitation.`accepted_by` = `users`.`id`
        AND invitation.`status` = 'accepted'
        AND pc.`phone` IS NOT NULL
        AND trim(pc.`phone`) <> ''
      ORDER BY invitation.`accepted_at` DESC, invitation.`id` DESC
      LIMIT 1
    )
  ),
  `address` = COALESCE(
    NULLIF(trim(`users`.`address`), ''),
    (
      SELECT NULLIF(trim(pc.`address`), '')
      FROM `project_access_invitations` invitation
      INNER JOIN `project_contacts` pc
        ON pc.`id` = invitation.`project_contact_id`
      WHERE invitation.`accepted_by` = `users`.`id`
        AND invitation.`status` = 'accepted'
        AND pc.`address` IS NOT NULL
        AND trim(pc.`address`) <> ''
      ORDER BY invitation.`accepted_at` DESC, invitation.`id` DESC
      LIMIT 1
    )
  )
WHERE EXISTS (
  SELECT 1
  FROM `project_access_invitations` invitation
  WHERE invitation.`accepted_by` = `users`.`id`
    AND invitation.`status` = 'accepted'
);
