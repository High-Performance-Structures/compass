CREATE TABLE `project_template_content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`module_type` text NOT NULL,
	`source_item_id` text,
	`parent_source_item_id` text,
	`title` text NOT NULL,
	`category` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	FOREIGN KEY (`version_id`) REFERENCES `project_template_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_template_content_version_module_source_unique` ON `project_template_content_items` (`version_id`,`module_type`,`source_item_id`);
--> statement-breakpoint
CREATE INDEX `project_template_content_version_module_order_idx` ON `project_template_content_items` (`version_id`,`module_type`,`sort_order`);
--> statement-breakpoint
UPDATE `project_templates`
SET `department_code` = CASE
  WHEN `department_code` = 'D' THEN 'Design'
  WHEN `department_code` = 'N' THEN 'Nu-Tech'
  WHEN `department_code` = 'H' THEN 'HPS'
  WHEN `department_code` = 'O' OR `department_code` IS NULL THEN 'ORC'
  ELSE `department_code`
END,
`source_url` = NULL
WHERE `source_system` = 'buildertrend';
