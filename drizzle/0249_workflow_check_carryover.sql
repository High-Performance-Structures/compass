-- A workflow tick carried over from a linked job (a Design job's completed
-- steps ticked on its Construction job), keeping who ticked it and when.
ALTER TABLE `project_workflow_checks` ADD `carried_from_project_id` text REFERENCES `projects`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `project_workflow_checks` ADD `carried_from_item_key` text;
