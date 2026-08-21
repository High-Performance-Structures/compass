ALTER TABLE `project_estimates` ADD `client_report_mode` text;

UPDATE `project_estimate_lines`
SET `owner_visible` = 1,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `owner_visible` = 0
  AND `specifications` LIKE '%PlanSwift source:%';
