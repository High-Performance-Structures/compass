-- Buildertrend and other legacy imports can predate directory linking. Attach
-- only contacts with one unambiguous organization-scoped match so similarly
-- named people or companies are left for manual review.
WITH `owner_matches` AS (
  SELECT pc.`id` AS `project_contact_id`, MIN(c.`id`) AS `directory_id`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `customers` c
    ON c.`organization_id` = p.`organization_id`
   AND (
     (pc.`email` IS NOT NULL AND trim(pc.`email`) <> ''
       AND c.`email` IS NOT NULL AND trim(c.`email`) <> ''
       AND lower(trim(pc.`email`)) = lower(trim(c.`email`)))
     OR lower(trim(pc.`display_name`)) = lower(trim(c.`name`))
     OR (pc.`company_name` IS NOT NULL AND trim(pc.`company_name`) <> ''
       AND lower(trim(pc.`company_name`)) = lower(trim(c.`name`)))
     OR (c.`company` IS NOT NULL AND trim(c.`company`) <> ''
       AND lower(trim(COALESCE(pc.`company_name`, pc.`display_name`))) = lower(trim(c.`company`)))
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
    SELECT m.`directory_id` FROM `owner_matches` m
    WHERE m.`project_contact_id` = `project_contacts`.`id`
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `owner_matches`);
--> statement-breakpoint

WITH `vendor_matches` AS (
  SELECT pc.`id` AS `project_contact_id`, MIN(v.`id`) AS `directory_id`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `vendors` v
    ON v.`organization_id` = p.`organization_id`
   AND (
     (pc.`email` IS NOT NULL AND trim(pc.`email`) <> ''
       AND v.`email` IS NOT NULL AND trim(v.`email`) <> ''
       AND lower(trim(pc.`email`)) = lower(trim(v.`email`)))
     OR lower(trim(pc.`display_name`)) = lower(trim(v.`name`))
     OR (pc.`company_name` IS NOT NULL AND trim(pc.`company_name`) <> ''
       AND lower(trim(pc.`company_name`)) = lower(trim(v.`name`)))
   )
  WHERE pc.`active` = 1
    AND pc.`contact_type` IN ('subcontractor', 'supplier')
    AND (pc.`source_entity_type` <> 'vendor' OR pc.`source_entity_id` IS NULL)
  GROUP BY pc.`id`
  HAVING COUNT(DISTINCT v.`id`) = 1
)
UPDATE `project_contacts`
SET
  `source_entity_type` = 'vendor',
  `source_entity_id` = (
    SELECT m.`directory_id` FROM `vendor_matches` m
    WHERE m.`project_contact_id` = `project_contacts`.`id`
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `vendor_matches`);
--> statement-breakpoint

WITH `team_matches` AS (
  SELECT pc.`id` AS `project_contact_id`, MIN(u.`id`) AS `directory_id`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `organization_members` om ON om.`organization_id` = p.`organization_id`
  INNER JOIN `users` u
    ON u.`id` = om.`user_id`
   AND u.`is_active` = 1
   AND u.`role` NOT IN ('client', 'subcontractor', 'supplier', 'guest')
   AND (
     (pc.`email` IS NOT NULL AND trim(pc.`email`) <> ''
       AND lower(trim(pc.`email`)) = lower(trim(u.`email`)))
     OR lower(trim(pc.`display_name`)) = lower(trim(COALESCE(
       NULLIF(trim(u.`display_name`), ''),
       NULLIF(trim(COALESCE(u.`first_name`, '') || ' ' || COALESCE(u.`last_name`, '')), ''),
       u.`email`
     )))
   )
  WHERE pc.`active` = 1
    AND pc.`contact_type` = 'internal'
    AND (pc.`source_entity_type` <> 'user' OR pc.`source_entity_id` IS NULL)
  GROUP BY pc.`id`
  HAVING COUNT(DISTINCT u.`id`) = 1
)
UPDATE `project_contacts`
SET
  `source_entity_type` = 'user',
  `source_entity_id` = (
    SELECT m.`directory_id` FROM `team_matches` m
    WHERE m.`project_contact_id` = `project_contacts`.`id`
  ),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `team_matches`);
--> statement-breakpoint

-- Keep the project-scoped snapshot synchronized with its canonical linked
-- directory identity. A blank directory field never erases known project data.
WITH `customer_identity` AS (
  SELECT pc.`id` AS `project_contact_id`, c.`email`, c.`phone`, c.`address`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `customers` c
    ON c.`id` = pc.`source_entity_id`
   AND c.`organization_id` = p.`organization_id`
  WHERE pc.`source_entity_type` = 'customer'
)
UPDATE `project_contacts`
SET
  `email` = COALESCE((SELECT NULLIF(trim(i.`email`), '') FROM `customer_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `email`),
  `phone` = COALESCE((SELECT NULLIF(trim(i.`phone`), '') FROM `customer_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `phone`),
  `address` = COALESCE((SELECT NULLIF(trim(i.`address`), '') FROM `customer_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `address`),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `customer_identity`);
--> statement-breakpoint

WITH `vendor_identity` AS (
  SELECT pc.`id` AS `project_contact_id`, v.`email`, v.`phone`, v.`address`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `vendors` v
    ON v.`id` = pc.`source_entity_id`
   AND v.`organization_id` = p.`organization_id`
  WHERE pc.`source_entity_type` = 'vendor'
)
UPDATE `project_contacts`
SET
  `email` = COALESCE((SELECT NULLIF(trim(i.`email`), '') FROM `vendor_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `email`),
  `phone` = COALESCE((SELECT NULLIF(trim(i.`phone`), '') FROM `vendor_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `phone`),
  `address` = COALESCE((SELECT NULLIF(trim(i.`address`), '') FROM `vendor_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `address`),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `vendor_identity`);
--> statement-breakpoint

WITH `team_identity` AS (
  SELECT DISTINCT pc.`id` AS `project_contact_id`, u.`email`, u.`phone`, u.`address`
  FROM `project_contacts` pc
  INNER JOIN `projects` p ON p.`id` = pc.`project_id`
  INNER JOIN `organization_members` om ON om.`organization_id` = p.`organization_id`
  INNER JOIN `users` u
    ON u.`id` = pc.`source_entity_id`
   AND u.`id` = om.`user_id`
  WHERE pc.`source_entity_type` = 'user'
)
UPDATE `project_contacts`
SET
  `email` = COALESCE((SELECT NULLIF(trim(i.`email`), '') FROM `team_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `email`),
  `phone` = COALESCE((SELECT NULLIF(trim(i.`phone`), '') FROM `team_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `phone`),
  `address` = COALESCE((SELECT NULLIF(trim(i.`address`), '') FROM `team_identity` i WHERE i.`project_contact_id` = `project_contacts`.`id`), `address`),
  `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `id` IN (SELECT `project_contact_id` FROM `team_identity`);
