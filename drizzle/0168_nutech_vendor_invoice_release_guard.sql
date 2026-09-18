CREATE TABLE `nutech_vendor_invoice_release_guards` (
  `workflow_id` text PRIMARY KEY NOT NULL,
  `valid` integer NOT NULL CHECK (`valid` = 1),
  `created_at` text NOT NULL
);
