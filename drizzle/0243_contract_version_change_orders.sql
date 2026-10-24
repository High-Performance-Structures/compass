-- Design and preconstruction billing can sit on a construction job beside
-- its contract. It never blocks replacing the construction contract estimate.
ALTER TABLE `invoices` ADD `billing_scope` text DEFAULT 'construction' NOT NULL;
--> statement-breakpoint
ALTER TABLE `payments` ADD `billing_scope` text DEFAULT 'construction' NOT NULL;
--> statement-breakpoint
-- Change orders created from a new contract-estimate version list each
-- changed line with its previous and new price.
ALTER TABLE `project_change_order_lines` ADD `change_kind` text;
--> statement-breakpoint
ALTER TABLE `project_change_order_lines` ADD `previous_amount_cents` integer;
--> statement-breakpoint
ALTER TABLE `project_change_order_lines` ADD `new_amount_cents` integer;
--> statement-breakpoint
-- Same guard as 0148, except preconstruction invoices and payments no longer
-- block a baseline replacement.
DROP TRIGGER IF EXISTS `project_change_orders_rebaseline_execution_guard`;
--> statement-breakpoint
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
      AND `billing_scope` <> 'preconstruction'
  ) OR EXISTS (
    SELECT 1 FROM `payments`
    WHERE `project_id` = NEW.`project_id`
      AND `billing_scope` <> 'preconstruction'
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
