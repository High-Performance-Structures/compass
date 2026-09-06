ALTER TABLE `invoices` ADD `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `source_system` text NOT NULL DEFAULT 'compass' CHECK(`source_system` IN ('buildertrend', 'compass', 'manual', 'sage'));
--> statement-breakpoint
ALTER TABLE `invoices` ADD `source_external_id` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
ALTER TABLE `payments` ADD `source_system` text NOT NULL DEFAULT 'compass' CHECK(`source_system` IN ('buildertrend', 'compass', 'manual', 'sage'));
--> statement-breakpoint
ALTER TABLE `payments` ADD `source_external_id` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD `gross_amount_cents` integer CHECK(`gross_amount_cents` IS NULL OR (typeof(`gross_amount_cents`) = 'integer' AND `gross_amount_cents` BETWEEN 0 AND 9007199254740991));
--> statement-breakpoint
ALTER TABLE `payments` ADD `processing_fee_cents` integer CHECK(`processing_fee_cents` IS NULL OR (typeof(`processing_fee_cents`) = 'integer' AND `processing_fee_cents` BETWEEN 0 AND 9007199254740991));
--> statement-breakpoint
ALTER TABLE `payments` ADD `net_amount_cents` integer CHECK(
  (`net_amount_cents` IS NULL AND `gross_amount_cents` IS NULL AND `processing_fee_cents` IS NULL)
  OR (`net_amount_cents` IS NOT NULL AND `gross_amount_cents` IS NOT NULL AND `processing_fee_cents` IS NOT NULL
    AND typeof(`net_amount_cents`) = 'integer' AND `net_amount_cents` BETWEEN 0 AND 9007199254740991
    AND typeof(`gross_amount_cents`) = 'integer' AND `gross_amount_cents` BETWEEN 0 AND 9007199254740991
    AND typeof(`processing_fee_cents`) = 'integer' AND `processing_fee_cents` BETWEEN 0 AND 9007199254740991
    AND `gross_amount_cents` = `processing_fee_cents` + `net_amount_cents`)
);
--> statement-breakpoint
ALTER TABLE `payments` ADD `cash_receipt` integer NOT NULL DEFAULT 1 CHECK(`cash_receipt` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `credit_memos` ADD `organization_id` text REFERENCES `organizations`(`id`);
--> statement-breakpoint
ALTER TABLE `credit_memos` ADD `source_system` text NOT NULL DEFAULT 'compass' CHECK(`source_system` IN ('buildertrend', 'compass', 'manual', 'sage'));
--> statement-breakpoint
ALTER TABLE `credit_memos` ADD `source_external_id` text;
--> statement-breakpoint
ALTER TABLE `credit_memos` ADD `cash_receipt` integer NOT NULL DEFAULT 0 CHECK(`cash_receipt` = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_scope_record_unique` ON `invoices` (`organization_id`, `project_id`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_scope_record_unique` ON `payments` (`organization_id`, `project_id`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_memos_scope_record_unique` ON `credit_memos` (`organization_id`, `project_id`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_organization_id_unique` ON `projects` (`organization_id`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_source_identity_unique` ON `invoices` (`organization_id`, `source_system`, `source_external_id`) WHERE `organization_id` IS NOT NULL AND `source_external_id` IS NOT NULL AND trim(`source_external_id`) <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_source_identity_unique` ON `payments` (`organization_id`, `source_system`, `source_external_id`) WHERE `organization_id` IS NOT NULL AND `source_external_id` IS NOT NULL AND trim(`source_external_id`) <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_memos_source_identity_unique` ON `credit_memos` (`organization_id`, `source_system`, `source_external_id`) WHERE `organization_id` IS NOT NULL AND `source_external_id` IS NOT NULL AND trim(`source_external_id`) <> '';
--> statement-breakpoint
CREATE TRIGGER `projects_source_scope_update`
BEFORE UPDATE OF `organization_id` ON `projects`
WHEN NEW.`organization_id` IS NOT OLD.`organization_id`
  AND (
    EXISTS (
      SELECT 1 FROM `invoices`
      WHERE `invoices`.`project_id` = OLD.`id`
        AND `invoices`.`source_external_id` IS NOT NULL
        AND `invoices`.`organization_id` IS NOT NEW.`organization_id`
    )
    OR EXISTS (
      SELECT 1 FROM `payments`
      WHERE `payments`.`project_id` = OLD.`id`
        AND `payments`.`source_external_id` IS NOT NULL
        AND `payments`.`organization_id` IS NOT NEW.`organization_id`
    )
    OR EXISTS (
      SELECT 1 FROM `credit_memos`
      WHERE `credit_memos`.`project_id` = OLD.`id`
        AND `credit_memos`.`source_external_id` IS NOT NULL
        AND `credit_memos`.`organization_id` IS NOT NEW.`organization_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'project organization change conflicts with sourced AR identity');
END;
--> statement-breakpoint
CREATE TRIGGER `invoices_source_scope_insert`
BEFORE INSERT ON `invoices`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'invoice source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TRIGGER `invoices_source_scope_update`
BEFORE UPDATE OF `organization_id`, `project_id`, `source_external_id` ON `invoices`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'invoice source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TRIGGER `payments_source_scope_insert`
BEFORE INSERT ON `payments`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'payment source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TRIGGER `payments_source_scope_update`
BEFORE UPDATE OF `organization_id`, `project_id`, `source_external_id` ON `payments`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'payment source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_memos_source_scope_insert`
BEFORE INSERT ON `credit_memos`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'credit source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TRIGGER `credit_memos_source_scope_update`
BEFORE UPDATE OF `organization_id`, `project_id`, `source_external_id` ON `credit_memos`
WHEN NEW.`source_external_id` IS NOT NULL AND (
  trim(NEW.`source_external_id`) = '' OR NEW.`organization_id` IS NULL OR NEW.`project_id` IS NULL
  OR NOT EXISTS (SELECT 1 FROM `projects` WHERE `projects`.`id` = NEW.`project_id` AND `projects`.`organization_id` = NEW.`organization_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'credit source identity requires non-empty id and exact organization/project scope');
END;
--> statement-breakpoint
CREATE TABLE `invoice_payment_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `invoice_id` text NOT NULL,
  `payment_id` text NOT NULL,
  `allocation_cents` integer NOT NULL CHECK(typeof(`allocation_cents`) = 'integer' AND `allocation_cents` BETWEEN 1 AND 9007199254740991),
  `created_at` text NOT NULL,
  CONSTRAINT `invoice_payment_allocations_invoice_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`, `invoice_id`)
    REFERENCES `invoices`(`organization_id`, `project_id`, `id`)
    ON DELETE RESTRICT,
  CONSTRAINT `invoice_payment_allocations_payment_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`, `payment_id`)
    REFERENCES `payments`(`organization_id`, `project_id`, `id`)
    ON DELETE RESTRICT,
  CONSTRAINT `invoice_payment_allocations_pair_unique` UNIQUE (`invoice_id`, `payment_id`),
  CONSTRAINT `invoice_payment_allocations_project_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`)
    REFERENCES `projects`(`organization_id`, `id`)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `invoice_payment_allocations_scope_idx` ON `invoice_payment_allocations` (`organization_id`, `project_id`);
--> statement-breakpoint
CREATE TABLE `invoice_credit_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `invoice_id` text NOT NULL,
  `credit_memo_id` text NOT NULL,
  `allocation_cents` integer NOT NULL CHECK(typeof(`allocation_cents`) = 'integer' AND `allocation_cents` BETWEEN 1 AND 9007199254740991),
  `created_at` text NOT NULL,
  CONSTRAINT `invoice_credit_allocations_invoice_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`, `invoice_id`)
    REFERENCES `invoices`(`organization_id`, `project_id`, `id`)
    ON DELETE RESTRICT,
  CONSTRAINT `invoice_credit_allocations_credit_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`, `credit_memo_id`)
    REFERENCES `credit_memos`(`organization_id`, `project_id`, `id`)
    ON DELETE RESTRICT,
  CONSTRAINT `invoice_credit_allocations_pair_unique` UNIQUE (`invoice_id`, `credit_memo_id`),
  CONSTRAINT `invoice_credit_allocations_project_scope_fk`
    FOREIGN KEY (`organization_id`, `project_id`)
    REFERENCES `projects`(`organization_id`, `id`)
    ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `invoice_credit_allocations_scope_idx` ON `invoice_credit_allocations` (`organization_id`, `project_id`);
