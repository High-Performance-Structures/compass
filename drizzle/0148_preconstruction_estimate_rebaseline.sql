ALTER TABLE `project_change_orders`
ADD `budget_treatment` text NOT NULL DEFAULT 'additive';

ALTER TABLE `project_change_orders`
ADD `baseline_estimate_id` text;

ALTER TABLE `project_change_orders`
ADD `replacement_estimate_id` text;

ALTER TABLE `project_change_orders`
ADD `rebaseline_execution_token` text;

ALTER TABLE `project_change_orders`
ADD `rebaseline_completed_at` text;

ALTER TABLE `project_change_orders`
ADD `rebaseline_completed_by` text REFERENCES `users`(`id`) ON DELETE SET NULL;

CREATE INDEX `project_change_orders_budget_treatment_idx`
ON `project_change_orders` (`project_id`, `budget_treatment`, `status`);

CREATE INDEX `project_change_orders_replacement_estimate_idx`
ON `project_change_orders` (`replacement_estimate_id`);

CREATE UNIQUE INDEX `project_change_orders_rebaseline_execution_token_uq`
ON `project_change_orders` (`rebaseline_execution_token`);

-- Historical application-level acceptance was intended to leave one accepted
-- estimate per project but did not have a database constraint. Preserve every
-- row while retaining the newest accepted version as the contractual baseline.
UPDATE `project_estimates` AS `stale`
SET `status` = 'superseded'
WHERE `stale`.`status` = 'accepted'
  AND EXISTS (
    SELECT 1
    FROM `project_estimates` AS `newer`
    WHERE `newer`.`project_id` = `stale`.`project_id`
      AND `newer`.`status` = 'accepted'
      AND (
        `newer`.`version_number` > `stale`.`version_number`
        OR (
          `newer`.`version_number` = `stale`.`version_number`
          AND `newer`.`created_at` > `stale`.`created_at`
        )
        OR (
          `newer`.`version_number` = `stale`.`version_number`
          AND `newer`.`created_at` = `stale`.`created_at`
          AND `newer`.`id` > `stale`.`id`
        )
      )
  );

CREATE UNIQUE INDEX `project_estimates_one_accepted_per_project_uq`
ON `project_estimates` (`project_id`)
WHERE `status` = 'accepted';

-- A replacement estimate linked to an amendment cannot be accepted through
-- the ordinary estimate/Foxit/contract paths. The rebaseline action claims the
-- amendment inside its final D1 batch before accepting the estimate.
CREATE TRIGGER `project_estimates_rebaseline_acceptance_guard`
BEFORE UPDATE OF `status` ON `project_estimates`
WHEN NEW.`status` = 'accepted'
  AND OLD.`status` <> 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'Execute the linked rebaseline amendment to accept this estimate')
  WHERE EXISTS (
    SELECT 1 FROM `project_change_orders`
    WHERE `project_id` = NEW.`project_id`
      AND `replacement_estimate_id` = NEW.`id`
      AND `budget_treatment` = 'baseline_replacement'
      AND `status` IN (
        'draft', 'submitted', 'triage', 'needs_information', 'pricing',
        'internal_review', 'approved_for_owner', 'signature_pending'
      )
      AND `rebaseline_execution_token` IS NULL
  );
END;

-- Read-side eligibility gives staff useful blocker messages. This trigger is
-- the final write-time gate, closing the concurrency window between that read
-- and the batch that accepts the replacement and publishes its budget.
CREATE TRIGGER `project_change_orders_rebaseline_execution_guard`
BEFORE UPDATE OF `status` ON `project_change_orders`
WHEN NEW.`budget_treatment` = 'baseline_replacement'
  AND NEW.`status` = 'executed'
  AND OLD.`status` <> 'executed'
BEGIN
  SELECT RAISE(ABORT, 'Rebaseline execution was not claimed')
  WHERE NEW.`rebaseline_execution_token` IS NULL;

  SELECT RAISE(ABORT, 'Rebaseline requires an owner-visible amendment')
  WHERE NEW.`audience` <> 'owner';

  SELECT RAISE(ABORT, 'Rebaseline estimate state changed; retry after review')
  WHERE NEW.`baseline_estimate_id` IS NULL
    OR NEW.`replacement_estimate_id` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `project_estimates`
      WHERE `id` = NEW.`baseline_estimate_id`
        AND `project_id` = NEW.`project_id`
        AND `status` = 'superseded'
    )
    OR NOT EXISTS (
      SELECT 1 FROM `project_estimates`
      WHERE `id` = NEW.`replacement_estimate_id`
        AND `project_id` = NEW.`project_id`
        AND `status` = 'accepted'
    );

  SELECT RAISE(ABORT, 'Rebaseline budget was not activated')
  WHERE NOT EXISTS (
    SELECT 1 FROM `project_contract_budget_revisions`
    WHERE `project_id` = NEW.`project_id`
      AND `accepted_estimate_id` = NEW.`replacement_estimate_id`
      AND `status` = 'current'
  ) OR NOT EXISTS (
    SELECT 1 FROM `project_budget_applications`
    WHERE `project_id` = NEW.`project_id`
      AND `source_system` = 'compass_contract_budget_projection'
      AND `status` = 'budget_current'
      AND `owner_visible` = 1
      AND `budget_revision_id` IN (
        SELECT `id` FROM `project_contract_budget_revisions`
        WHERE `project_id` = NEW.`project_id`
          AND `accepted_estimate_id` = NEW.`replacement_estimate_id`
          AND `status` = 'current'
      )
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by posted project costs')
  WHERE EXISTS (
    SELECT 1 FROM `project_budget_lines`
    WHERE `project_id` = NEW.`project_id`
      AND (
        `previous_work_completed` <> 0
        OR `current_work_completed` <> 0
        OR `stored_materials` <> 0
        OR `prior_costs` <> 0
        OR `current_costs` <> 0
        OR `total_costs` <> 0
      )
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by an existing purchase order')
  WHERE EXISTS (
    SELECT 1 FROM `project_operations`
    WHERE `project_id` = NEW.`project_id`
      AND `source_record_type` IN ('purchase_order', 'google_nutech_order')
      AND lower(`status`) NOT IN ('void', 'cancelled', 'canceled')
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by an existing vendor bill')
  WHERE EXISTS (
    SELECT 1 FROM `vendor_bills`
    WHERE `project_id` = NEW.`project_id`
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by an invoice or payment')
  WHERE EXISTS (
    SELECT 1 FROM `invoices`
    WHERE `project_id` = NEW.`project_id`
  ) OR EXISTS (
    SELECT 1 FROM `payments`
    WHERE `project_id` = NEW.`project_id`
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by a payment application')
  WHERE EXISTS (
    SELECT 1 FROM `project_budget_applications`
    WHERE `project_id` = NEW.`project_id`
      AND `source_system` <> 'compass_contract_budget_projection'
  );

  SELECT RAISE(ABORT, 'Rebaseline blocked by an executed budget adjustment')
  WHERE EXISTS (
    SELECT 1 FROM `project_change_orders`
    WHERE `project_id` = NEW.`project_id`
      AND `id` <> NEW.`id`
      AND `budget_treatment` = 'additive'
      AND `status` IN ('executed', 'sage_pending', 'synced', 'closed')
  );
END;

-- This history insert is the final statement in the activation batch. If a
-- concurrent transition made the guarded change-order UPDATE match no rows,
-- abort here so every earlier estimate and budget statement rolls back.
CREATE TRIGGER `project_change_order_history_rebaseline_execution_guard`
BEFORE INSERT ON `project_change_order_history`
WHEN NEW.`event_type` = 'baseline_replaced'
BEGIN
  SELECT RAISE(ABORT, 'Rebaseline amendment is no longer executable')
  WHERE NOT EXISTS (
    SELECT 1 FROM `project_change_orders`
    WHERE `id` = NEW.`change_order_id`
      AND `project_id` = NEW.`project_id`
      AND `status` = 'executed'
      AND `budget_treatment` = 'baseline_replacement'
      AND `rebaseline_execution_token` IS NOT NULL
      AND `rebaseline_execution_token` =
        json_extract(NEW.`metadata_json`, '$.executionToken')
      AND `rebaseline_completed_at` IS NOT NULL
  );
END;
