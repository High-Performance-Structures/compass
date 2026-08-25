ALTER TABLE `project_estimates` ADD `client_mailing_address` text;

UPDATE `project_estimates`
SET `client_mailing_address` = (
  SELECT `projects`.`mailing_address`
  FROM `projects`
  WHERE `projects`.`id` = `project_estimates`.`project_id`
)
WHERE `client_mailing_address` IS NULL;
