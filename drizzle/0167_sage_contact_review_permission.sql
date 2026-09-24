-- Initial reviewers follow the existing editable private-contact grants.
-- Future reviewer changes are made in Settings > Permissions, not in code.
INSERT INTO `user_permission_overrides` (
  `id`, `organization_id`, `user_id`, `feature_id`, `access_level`,
  `created_at`, `updated_at`
)
SELECT
  'initial-sage-contact-review-' || grant.`organization_id` || '-' || grant.`user_id`,
  grant.`organization_id`, grant.`user_id`, 'sage-contact-review', 'approve',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `user_permission_overrides` grant
WHERE grant.`feature_id` = 'employee-contact-private'
  AND grant.`access_level` = 'approve';
--> statement-breakpoint
INSERT INTO `permission_audit_events` (
  `id`, `organization_id`, `scope`, `user_id`, `feature_id`,
  `previous_access_level`, `next_access_level`, `created_at`
)
SELECT
  'initial-sage-contact-review-audit-' || grant.`organization_id` || '-' || grant.`user_id`,
  grant.`organization_id`, 'user', grant.`user_id`, 'sage-contact-review',
  NULL, grant.`access_level`, grant.`created_at`
FROM `user_permission_overrides` grant
WHERE grant.`feature_id` = 'sage-contact-review';
