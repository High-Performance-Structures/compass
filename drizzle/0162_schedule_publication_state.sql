ALTER TABLE `projects` ADD `schedule_published` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `projects`
SET `schedule_published` = 1
WHERE EXISTS (
  SELECT 1 FROM `schedule_publications`
  WHERE `schedule_publications`.`project_id` = `projects`.`id`
);
