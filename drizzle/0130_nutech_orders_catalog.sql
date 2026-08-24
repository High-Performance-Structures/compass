CREATE TABLE `nutech_catalog_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`effective_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`new_standard_sheet_id` text NOT NULL,
	`new_cash_sheet_id` text NOT NULL,
	`returning_standard_sheet_id` text NOT NULL,
	`returning_cash_sheet_id` text NOT NULL,
	`airlite_template_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`imported_at` text NOT NULL,
	`imported_by` text,
	`activated_at` text,
	`activated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`activated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_catalog_versions_org_name_uq` ON `nutech_catalog_versions` (`organization_id`,`name`);
--> statement-breakpoint
CREATE INDEX `nutech_catalog_versions_org_status_idx` ON `nutech_catalog_versions` (`organization_id`,`status`,`effective_date`);
--> statement-breakpoint
CREATE TABLE `nutech_products` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`manufacturer_sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`origin` text NOT NULL,
	`price_unit` text NOT NULL,
	`package_quantity` integer DEFAULT 1 NOT NULL,
	`package_label` text NOT NULL,
	`minimum_order_increment` integer DEFAULT 1 NOT NULL,
	`square_feet_per_unit_mils` integer,
	`airlite_template_sku` text,
	`airlite_template_row` integer,
	`airlite_mapping_status` text DEFAULT 'addendum_required' NOT NULL,
	`sage_cost_code_id` text,
	`sage_mapping_status` text DEFAULT 'unmapped' NOT NULL,
	`sage_mapped_at` text,
	`sage_mapped_by` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sage_cost_code_id`) REFERENCES `sage_cost_codes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sage_mapped_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_products_org_sku_uq` ON `nutech_products` (`organization_id`,`manufacturer_sku`);
--> statement-breakpoint
CREATE INDEX `nutech_products_org_category_idx` ON `nutech_products` (`organization_id`,`category`,`active`);
--> statement-breakpoint
CREATE INDEX `nutech_products_sage_cost_code_idx` ON `nutech_products` (`sage_cost_code_id`);
--> statement-breakpoint
CREATE TABLE `nutech_catalog_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_version_id` text NOT NULL,
	`product_id` text NOT NULL,
	`airlite_cost_cents` integer NOT NULL,
	`new_standard_price_cents` integer NOT NULL,
	`new_cash_price_cents` integer NOT NULL,
	`returning_standard_price_cents` integer NOT NULL,
	`returning_cash_price_cents` integer NOT NULL,
	`new_standard_margin_basis_points` integer NOT NULL,
	`new_cash_margin_basis_points` integer NOT NULL,
	`returning_standard_margin_basis_points` integer NOT NULL,
	`returning_cash_margin_basis_points` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`catalog_version_id`) REFERENCES `nutech_catalog_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `nutech_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_catalog_prices_version_product_uq` ON `nutech_catalog_prices` (`catalog_version_id`,`product_id`);
--> statement-breakpoint
CREATE INDEX `nutech_catalog_prices_product_idx` ON `nutech_catalog_prices` (`product_id`);
--> statement-breakpoint
CREATE TABLE `nutech_order_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`catalog_version_id` text,
	`customer_type` text NOT NULL,
	`pricing_mode` text NOT NULL,
	`quantity_source` text NOT NULL,
	`takeoff_acknowledgement_status` text DEFAULT 'not_required' NOT NULL,
	`scope_type` text DEFAULT 'block_sale' NOT NULL,
	`block_quantity_notes` text,
	`bracing_included` integer DEFAULT false NOT NULL,
	`bracing_rental_start_date` text,
	`bracing_rental_end_date` text,
	`bracing_notes` text,
	`delivery_method` text DEFAULT 'delivery' NOT NULL,
	`requested_delivery_date` text,
	`airlite_purchase_order_operation_id` text,
	`order_status` text DEFAULT 'intake' NOT NULL,
	`vendor_confirmation_number` text,
	`airlite_workbook_id` text,
	`airlite_workbook_url` text,
	`airlite_workbook_status` text DEFAULT 'not_generated' NOT NULL,
	`airlite_workbook_generated_at` text,
	`airlite_workbook_generated_by` text,
	`purchase_order_released_at` text,
	`purchase_order_released_by` text,
	`vendor_invoice_number` text,
	`vendor_invoice_status` text DEFAULT 'not_received' NOT NULL,
	`vendor_invoice_received_at` text,
	`vendor_invoice_released_at` text,
	`vendor_invoice_released_by` text,
	`notes` text,
	`created_by` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_version_id`) REFERENCES `nutech_catalog_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`airlite_purchase_order_operation_id`) REFERENCES `project_operations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`airlite_workbook_generated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchase_order_released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vendor_invoice_released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_order_workflows_project_uq` ON `nutech_order_workflows` (`project_id`);
--> statement-breakpoint
CREATE INDEX `nutech_order_workflows_status_idx` ON `nutech_order_workflows` (`order_status`,`requested_delivery_date`);
--> statement-breakpoint
CREATE INDEX `nutech_order_workflows_po_idx` ON `nutech_order_workflows` (`airlite_purchase_order_operation_id`);
--> statement-breakpoint
CREATE INDEX `nutech_order_workflows_catalog_idx` ON `nutech_order_workflows` (`catalog_version_id`);
--> statement-breakpoint
CREATE TABLE `nutech_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`product_id` text NOT NULL,
	`catalog_version_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`manufacturer_sku_snapshot` text NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`price_unit_snapshot` text NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `nutech_order_workflows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `nutech_products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`catalog_version_id`) REFERENCES `nutech_catalog_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutech_order_items_workflow_product_uq` ON `nutech_order_items` (`workflow_id`,`product_id`);
--> statement-breakpoint
CREATE INDEX `nutech_order_items_workflow_sort_idx` ON `nutech_order_items` (`workflow_id`,`sort_order`);
