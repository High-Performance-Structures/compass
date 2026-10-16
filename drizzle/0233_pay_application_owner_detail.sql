-- Client detail for one pay application; null uses the company default
-- (Settings -> Workflows -> Pay applications).
ALTER TABLE `project_budget_applications` ADD `owner_detail` text;
