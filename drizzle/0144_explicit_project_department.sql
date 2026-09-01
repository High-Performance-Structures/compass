ALTER TABLE `projects` ADD `department` text CHECK (`department` IS NULL OR `department` IN ('O', 'H', 'N', 'D'));
--> statement-breakpoint
UPDATE `projects`
SET `department` = 'N'
WHERE `department` IS NULL
  AND (`id` = 'proj-bt-nu-tech-job' OR `buildertrend_project_id` = '10555479');
--> statement-breakpoint
UPDATE `projects`
SET `department` = upper(substr(trim(`project_number`), 1, 1))
WHERE `department` IS NULL
  AND upper(substr(trim(`project_number`), 1, 1)) IN ('O', 'H', 'N', 'D')
  AND substr(trim(`project_number`), 2, 1) = '-';
--> statement-breakpoint
UPDATE `projects`
SET `department` = upper(substr(`id`, 9, 1))
WHERE `department` IS NULL
  AND lower(substr(`id`, 1, 8)) = 'proj-bt-'
  AND lower(substr(`id`, 10, 1)) = '-'
  AND upper(substr(`id`, 9, 1)) IN ('O', 'H', 'N', 'D');
