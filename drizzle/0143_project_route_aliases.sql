CREATE TABLE `project_route_aliases` (
	`source_project_id` text PRIMARY KEY NOT NULL,
	`target_project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`source_system` text DEFAULT 'compass' NOT NULL,
	`source_external_id` text,
	`reason` text,
	`created_at` text NOT NULL,
	CONSTRAINT `project_route_aliases_distinct_projects_check` CHECK (`source_project_id` <> `target_project_id`),
	FOREIGN KEY (`target_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_route_aliases_target_idx` ON `project_route_aliases` (`target_project_id`);
--> statement-breakpoint
CREATE INDEX `project_route_aliases_organization_idx` ON `project_route_aliases` (`organization_id`);
--> statement-breakpoint
CREATE TRIGGER `project_route_aliases_target_organization_insert`
BEFORE INSERT ON `project_route_aliases`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM `projects`
	WHERE `projects`.`id` = NEW.`target_project_id`
		AND `projects`.`organization_id` = NEW.`organization_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Project route alias target must belong to the same organization');
END;
--> statement-breakpoint
CREATE TRIGGER `project_route_aliases_target_organization_update`
BEFORE UPDATE OF `target_project_id`, `organization_id` ON `project_route_aliases`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM `projects`
	WHERE `projects`.`id` = NEW.`target_project_id`
		AND `projects`.`organization_id` = NEW.`organization_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Project route alias target must belong to the same organization');
END;
