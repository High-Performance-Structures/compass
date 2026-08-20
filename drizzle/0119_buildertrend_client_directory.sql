ALTER TABLE `customers` ADD `buildertrend_contact_id` text;
--> statement-breakpoint
ALTER TABLE `customers` ADD `relationship_type` text DEFAULT 'client' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_sage_client_id_unique`
  ON `customers` (`organization_id`, `sage_client_id`)
  WHERE `sage_client_id` IS NOT NULL AND trim(`sage_client_id`) <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_sage_client_number_unique`
  ON `customers` (`organization_id`, `sage_client_number`)
  WHERE `sage_client_number` IS NOT NULL AND trim(`sage_client_number`) <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_org_buildertrend_contact_unique`
  ON `customers` (`organization_id`, `buildertrend_contact_id`)
  WHERE `buildertrend_contact_id` IS NOT NULL AND trim(`buildertrend_contact_id`) <> '';
--> statement-breakpoint

-- Preserve a one-to-one Buildertrend identity on an existing Compass/Sage
-- client instead of inserting a duplicate directory row.
WITH `stable_buildertrend_clients` AS (
  SELECT
    bac.`organization_id`,
    bac.`buildertrend_contact_id`,
    MIN(trim(bac.`contact_name`)) AS `contact_name`,
    MAX(NULLIF(trim(bac.`email`), '')) AS `email`,
    MAX(NULLIF(trim(bac.`phone`), '')) AS `phone`,
    CASE
      WHEN MAX(CASE WHEN bac.`buildertrend_access_role` = 'lead_contact' THEN 1 ELSE 0 END) = 1
        AND MAX(CASE WHEN bac.`buildertrend_access_role` = 'client' THEN 1 ELSE 0 END) = 0
        THEN 'lead'
      ELSE 'client'
    END AS `relationship_type`
  FROM `buildertrend_staging_access_candidates` bac
  WHERE bac.`organization_id` IS NOT NULL
    AND bac.`buildertrend_contact_id` IS NOT NULL
    AND trim(bac.`buildertrend_contact_id`) <> ''
    AND bac.`contact_name` IS NOT NULL
    AND trim(bac.`contact_name`) <> ''
    AND (
      bac.`proposed_contact_type` = 'owner'
      OR bac.`buildertrend_access_role` IN ('client', 'client_contact', 'lead_contact')
    )
  GROUP BY bac.`organization_id`, bac.`buildertrend_contact_id`
  HAVING COUNT(DISTINCT lower(trim(bac.`contact_name`))) = 1
),
`possible_matches` AS (
  SELECT
    sbc.`organization_id`,
    sbc.`buildertrend_contact_id`,
    c.`id` AS `customer_id`
  FROM `stable_buildertrend_clients` sbc
  INNER JOIN `customers` c
    ON c.`organization_id` = sbc.`organization_id`
   AND (
     (sbc.`email` IS NOT NULL
       AND c.`email` IS NOT NULL
       AND lower(trim(c.`email`)) = lower(sbc.`email`))
     OR (
       lower(trim(c.`name`)) = lower(sbc.`contact_name`)
       AND (
         sbc.`phone` IS NULL
         OR c.`phone` IS NULL
         OR trim(c.`phone`) = sbc.`phone`
       )
     )
   )
  WHERE c.`buildertrend_contact_id` IS NULL
),
`source_unique_matches` AS (
  SELECT
    pm.`organization_id`,
    pm.`buildertrend_contact_id`,
    MIN(pm.`customer_id`) AS `customer_id`
  FROM `possible_matches` pm
  GROUP BY pm.`organization_id`, pm.`buildertrend_contact_id`
  HAVING COUNT(DISTINCT pm.`customer_id`) = 1
),
`one_to_one_matches` AS (
  SELECT
    source_match.`customer_id`,
    MIN(source_match.`buildertrend_contact_id`) AS `buildertrend_contact_id`
  FROM `source_unique_matches` source_match
  GROUP BY source_match.`customer_id`
  HAVING COUNT(DISTINCT source_match.`buildertrend_contact_id`) = 1
)
UPDATE `customers`
SET
  `buildertrend_contact_id` = (
    SELECT otm.`buildertrend_contact_id`
    FROM `one_to_one_matches` otm
    WHERE otm.`customer_id` = `customers`.`id`
  ),
  `email` = COALESCE(
    NULLIF(trim(`email`), ''),
    (
      SELECT sbc.`email`
      FROM `stable_buildertrend_clients` sbc
      INNER JOIN `one_to_one_matches` otm
        ON otm.`buildertrend_contact_id` = sbc.`buildertrend_contact_id`
      WHERE otm.`customer_id` = `customers`.`id`
    )
  ),
  `phone` = COALESCE(
    NULLIF(trim(`phone`), ''),
    (
      SELECT sbc.`phone`
      FROM `stable_buildertrend_clients` sbc
      INNER JOIN `one_to_one_matches` otm
        ON otm.`buildertrend_contact_id` = sbc.`buildertrend_contact_id`
      WHERE otm.`customer_id` = `customers`.`id`
    )
  )
WHERE `id` IN (SELECT `customer_id` FROM `one_to_one_matches`);
--> statement-breakpoint

-- Promote only stable Buildertrend client identities. Four source IDs currently
-- carry conflicting names and intentionally remain in staging for review.
WITH `buildertrend_clients` AS (
  SELECT
    bac.`organization_id`,
    bac.`buildertrend_contact_id`,
    MIN(trim(bac.`contact_name`)) AS `contact_name`,
    MAX(NULLIF(trim(bac.`email`), '')) AS `email`,
    MAX(NULLIF(trim(bac.`phone`), '')) AS `phone`,
    CASE
      WHEN MAX(CASE WHEN bac.`buildertrend_access_role` = 'lead_contact' THEN 1 ELSE 0 END) = 1
        AND MAX(CASE WHEN bac.`buildertrend_access_role` = 'client' THEN 1 ELSE 0 END) = 0
        THEN 'lead'
      ELSE 'client'
    END AS `relationship_type`,
    MIN(bac.`created_at`) AS `created_at`,
    MAX(bac.`updated_at`) AS `updated_at`
  FROM `buildertrend_staging_access_candidates` bac
  WHERE bac.`organization_id` IS NOT NULL
    AND bac.`buildertrend_contact_id` IS NOT NULL
    AND trim(bac.`buildertrend_contact_id`) <> ''
    AND bac.`contact_name` IS NOT NULL
    AND trim(bac.`contact_name`) <> ''
    AND (
      bac.`proposed_contact_type` = 'owner'
      OR bac.`buildertrend_access_role` IN ('client', 'client_contact', 'lead_contact')
    )
  GROUP BY bac.`organization_id`, bac.`buildertrend_contact_id`
  HAVING COUNT(DISTINCT lower(trim(bac.`contact_name`))) = 1
)
INSERT OR IGNORE INTO `customers` (
  `id`, `name`, `company`, `email`, `phone`, `address`, `notes`,
  `netsuite_id`, `sage_client_id`, `sage_client_number`,
  `sage_client_status_id`, `buildertrend_contact_id`, `relationship_type`,
  `organization_id`, `created_at`, `updated_at`
)
SELECT
  'buildertrend-customer-' || bc.`organization_id` || '-' || bc.`buildertrend_contact_id`,
  bc.`contact_name`,
  NULL,
  bc.`email`,
  bc.`phone`,
  NULL,
  'Imported from the Buildertrend client contact directory. Review before granting portal access.',
  NULL,
  NULL,
  NULL,
  NULL,
  bc.`buildertrend_contact_id`,
  bc.`relationship_type`,
  bc.`organization_id`,
  COALESCE(bc.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(bc.`updated_at`, bc.`created_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM `buildertrend_clients` bc
WHERE NOT EXISTS (
  SELECT 1
  FROM `customers` c
  WHERE c.`organization_id` = bc.`organization_id`
    AND c.`buildertrend_contact_id` = bc.`buildertrend_contact_id`
);
--> statement-breakpoint

-- Link imported project owner rows only when one organization-scoped client
-- directory record matches exactly. Ambiguous names remain manual.
WITH `customer_matches` AS (
  SELECT pc.`id` AS `project_contact_id`, MIN(c.`id`) AS `customer_id`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `customers` c
    ON c.`organization_id` = p.`organization_id`
   AND (
     (pc.`email` IS NOT NULL AND trim(pc.`email`) <> ''
       AND c.`email` IS NOT NULL AND trim(c.`email`) <> ''
       AND lower(trim(pc.`email`)) = lower(trim(c.`email`)))
     OR (
       lower(trim(pc.`display_name`)) = lower(trim(c.`name`))
       AND (
         pc.`phone` IS NULL OR trim(pc.`phone`) = ''
         OR (c.`phone` IS NOT NULL AND trim(c.`phone`) = trim(pc.`phone`))
       )
     )
   )
  WHERE pc.`active` = 1
    AND pc.`contact_type` = 'owner'
    AND (pc.`source_entity_type` <> 'customer' OR pc.`source_entity_id` IS NULL)
  GROUP BY pc.`id`
  HAVING COUNT(DISTINCT c.`id`) = 1
)
UPDATE `project_contacts`
SET
  `source_entity_type` = 'customer',
  `source_entity_id` = (
    SELECT cm.`customer_id`
    FROM `customer_matches` cm
    WHERE cm.`project_contact_id` = `project_contacts`.`id`
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `customer_matches`);
