-- Independent editable staff permissions for confidential contact access and
-- formerly Executive Admin-only workflows. Runtime access is not email-based.
CREATE TABLE `user_permission_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `feature_id` text NOT NULL,
  `access_level` text NOT NULL,
  `created_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `updated_by` text REFERENCES `users`(`id`) ON DELETE set null,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_permission_overrides_unique` ON `user_permission_overrides` (`organization_id`, `user_id`, `feature_id`);
--> statement-breakpoint
CREATE INDEX `user_permission_overrides_org_idx` ON `user_permission_overrides` (`organization_id`);
--> statement-breakpoint
ALTER TABLE `permission_audit_events` ADD `user_id` text REFERENCES `users`(`id`) ON DELETE set null;
--> statement-breakpoint
-- One-time initial grants for current Executive Admin staff; subsequent
-- membership changes happen in Compass Settings > Permissions.
INSERT INTO `user_permission_overrides` (
  `id`, `organization_id`, `user_id`, `feature_id`, `access_level`,
  `created_at`, `updated_at`
)
SELECT
  'initial-staff-grant-' || feature.`feature_id` || '-' || om.`organization_id` || '-' || u.`id`,
  om.`organization_id`, u.`id`, feature.`feature_id`, 'approve',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `organization_members` om
JOIN `organizations` o ON o.`id` = om.`organization_id`
JOIN `users` u ON u.`id` = om.`user_id`
CROSS JOIN (
  SELECT 'employee-contact-private' AS `feature_id`
  UNION ALL SELECT 'cherish-review'
  UNION ALL SELECT 'greeting-card-approval'
  UNION ALL SELECT 'project-archive-access'
) feature
WHERE o.`type` = 'internal'
  AND u.`is_active` = 1
  AND lower(trim(u.`email`)) IN (
    'dan@hps-colorado.com',
    'martine@hps-colorado.com',
    'martine@openrangeconstruction.com'
  )
GROUP BY om.`organization_id`, u.`id`, feature.`feature_id`;
--> statement-breakpoint
INSERT INTO `permission_audit_events` (
  `id`, `organization_id`, `scope`, `user_id`, `feature_id`,
  `previous_access_level`, `next_access_level`, `created_at`
)
SELECT
  'initial-audit-' || grant.`feature_id` || '-' || grant.`organization_id` || '-' || grant.`user_id`,
  grant.`organization_id`, 'user', grant.`user_id`, grant.`feature_id`,
  NULL, grant.`access_level`, grant.`created_at`
FROM `user_permission_overrides` grant
WHERE grant.`feature_id` IN (
  'employee-contact-private', 'cherish-review',
  'greeting-card-approval', 'project-archive-access'
);
