-- Repair the Buildertrend identity-review organization guard. Users are
-- organization-scoped through organization_members, not a users column.
DROP TRIGGER IF EXISTS `buildertrend_identity_review_run_scope_guard`;
--> statement-breakpoint
CREATE TRIGGER `buildertrend_identity_review_run_scope_guard`
BEFORE INSERT ON `buildertrend_staging_identity_review_runs`
WHEN (
  NOT EXISTS (
    SELECT 1
    FROM `organizations`
    WHERE `id` = NEW.`organization_id`
  )
  OR (
    NEW.`reviewed_by` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM `users` reviewer
      JOIN `organization_members` membership
        ON membership.`user_id` = reviewer.`id`
      WHERE reviewer.`id` = NEW.`reviewed_by`
        AND membership.`organization_id` = NEW.`organization_id`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend identity review runs must remain organization scoped');
END;
