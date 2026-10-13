-- Departments can allow several estimates per job (Settings → Workflows →
-- Estimates). Only one version of each estimate number can be accepted;
-- one-estimate departments still supersede earlier accepted estimates in the
-- app when a new one is accepted.
DROP INDEX IF EXISTS `project_estimates_one_accepted_per_project_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_estimates_one_accepted_per_number_uq` ON `project_estimates` (`project_id`, `estimate_number`) WHERE `status` = 'accepted';
