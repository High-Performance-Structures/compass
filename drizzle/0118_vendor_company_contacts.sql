CREATE TABLE `vendor_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_id` text NOT NULL,
  `name` text NOT NULL,
  `title` text,
  `email` text,
  `phone` text,
  `is_primary` integer DEFAULT false NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `source_system` text DEFAULT 'manual' NOT NULL,
  `source_record_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vendor_contacts_vendor_idx` ON `vendor_contacts` (`vendor_id`);
--> statement-breakpoint
CREATE INDEX `vendor_contacts_vendor_active_idx` ON `vendor_contacts` (`vendor_id`, `active`);
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `vendor_id` text REFERENCES `vendors`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `project_contacts` ADD `vendor_contact_id` text REFERENCES `vendor_contacts`(`id`) ON DELETE set null;
--> statement-breakpoint

-- Preserve the contact information that was historically flattened onto each
-- Sage/Compass vendor company as its first contact person. Sage source metadata
-- supplies the person name when it is available.
INSERT INTO `vendor_contacts` (
  `id`, `vendor_id`, `name`, `title`, `email`, `phone`, `is_primary`, `active`,
  `source_system`, `source_record_id`, `created_at`, `updated_at`
)
SELECT
  'vendor-contact-primary-' || v.`id`,
  v.`id`,
  COALESCE(
    NULLIF(
      trim(json_extract(
        CASE WHEN json_valid(v.`source_metadata`) THEN v.`source_metadata` ELSE '{}' END,
        '$.sage.contact'
      )),
      ''
    ),
    v.`name`
  ),
  NULL,
  NULLIF(trim(v.`email`), ''),
  NULLIF(trim(v.`phone`), ''),
  1,
  1,
  v.`source_system`,
  v.`source_record_id`,
  COALESCE(v.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(v.`updated_at`, v.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM `vendors` v
WHERE (
  (v.`email` IS NOT NULL AND trim(v.`email`) <> '')
  OR (v.`phone` IS NOT NULL AND trim(v.`phone`) <> '')
  OR NULLIF(
    trim(json_extract(
      CASE WHEN json_valid(v.`source_metadata`) THEN v.`source_metadata` ELSE '{}' END,
      '$.sage.contact'
    )),
    ''
  ) IS NOT NULL
);
--> statement-breakpoint

-- Existing project vendor rows already identify the canonical company. Keep
-- that relationship explicit so multiple people can be attached to the same
-- company without duplicating the company directory record.
UPDATE `project_contacts`
SET `vendor_id` = `source_entity_id`
WHERE `source_entity_type` = 'vendor'
  AND `source_entity_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `vendors` v WHERE v.`id` = `project_contacts`.`source_entity_id`
  );
--> statement-breakpoint

-- Link a legacy project row to the promoted primary person only when its
-- identity matches. Company-only project assignments remain company-only.
UPDATE `project_contacts`
SET `vendor_contact_id` = (
  SELECT vc.`id`
  FROM `vendor_contacts` vc
  WHERE vc.`vendor_id` = `project_contacts`.`vendor_id`
    AND vc.`active` = 1
    AND (
      (`project_contacts`.`email` IS NOT NULL
        AND trim(`project_contacts`.`email`) <> ''
        AND vc.`email` IS NOT NULL
        AND lower(trim(vc.`email`)) = lower(trim(`project_contacts`.`email`)))
      OR lower(trim(vc.`name`)) = lower(trim(`project_contacts`.`display_name`))
    )
  ORDER BY vc.`is_primary` DESC, vc.`created_at`, vc.`id`
  LIMIT 1
)
WHERE `vendor_id` IS NOT NULL
  AND `vendor_contact_id` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `vendor_contacts` vc
    WHERE vc.`vendor_id` = `project_contacts`.`vendor_id`
      AND vc.`active` = 1
      AND (
        (`project_contacts`.`email` IS NOT NULL
          AND trim(`project_contacts`.`email`) <> ''
          AND vc.`email` IS NOT NULL
          AND lower(trim(vc.`email`)) = lower(trim(`project_contacts`.`email`)))
        OR lower(trim(vc.`name`)) = lower(trim(`project_contacts`.`display_name`))
      )
  );
