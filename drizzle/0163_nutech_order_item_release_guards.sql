-- Keep released Airlite PO quantities immutable even when an item mutation
-- started before the release transition and reaches D1 afterward.
CREATE TRIGGER `nutech_order_items_block_insert_after_release`
BEFORE INSERT ON `nutech_order_items`
WHEN EXISTS (
  SELECT 1
  FROM `nutech_order_workflows`
  WHERE `nutech_order_workflows`.`id` = NEW.`workflow_id`
    AND `nutech_order_workflows`.`purchase_order_released_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Released Airlite PO quantities are locked.');
END;
--> statement-breakpoint
CREATE TRIGGER `nutech_order_items_block_update_after_release`
BEFORE UPDATE ON `nutech_order_items`
WHEN EXISTS (
  SELECT 1
  FROM `nutech_order_workflows`
  WHERE (
    (`nutech_order_workflows`.`id` = OLD.`workflow_id`
      OR `nutech_order_workflows`.`id` = NEW.`workflow_id`)
    AND `nutech_order_workflows`.`purchase_order_released_at` IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Released Airlite PO quantities are locked.');
END;
--> statement-breakpoint
CREATE TRIGGER `nutech_order_items_block_delete_after_release`
BEFORE DELETE ON `nutech_order_items`
WHEN EXISTS (
  SELECT 1
  FROM `nutech_order_workflows`
  WHERE `nutech_order_workflows`.`id` = OLD.`workflow_id`
    AND `nutech_order_workflows`.`purchase_order_released_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Released Airlite PO quantities are locked.');
END;
