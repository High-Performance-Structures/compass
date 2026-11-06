-- Settings › Statuses: each company's status options per record type
-- (purchase orders, RFQs, RFIs, to-dos). Built-in rows rename, recolor,
-- regroup, reorder or hide a status Compass code depends on; other rows are
-- statuses the company added. A record type with no rows keeps its code
-- defaults, so nothing changes until a company edits its statuses.
-- Additive only: one new table and its unique index.
CREATE TABLE `organization_record_statuses` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `record_type` text NOT NULL CHECK (`record_type` IN ('purchase_order', 'rfq', 'rfi', 'todo')),
  `status_key` text NOT NULL,
  `label` text NOT NULL,
  `color` text NOT NULL DEFAULT 'gray' CHECK (`color` IN ('gray', 'blue', 'green', 'orange', 'red')),
  `status_group` text NOT NULL DEFAULT 'open' CHECK (`status_group` IN ('open', 'closed', 'void')),
  `sort_order` integer NOT NULL DEFAULT 0,
  `show_as_button` integer NOT NULL DEFAULT true,
  `hidden` integer NOT NULL DEFAULT false,
  `built_in` integer NOT NULL DEFAULT false,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_record_statuses_org_type_key_unique` ON `organization_record_statuses` (`organization_id`, `record_type`, `status_key`);
