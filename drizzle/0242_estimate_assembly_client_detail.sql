-- Assemblies whose cost codes and cost breakdowns the client report lists
-- even when the report otherwise shows assembly totals only.
ALTER TABLE `project_estimate_assemblies` ADD `client_detail` integer DEFAULT false NOT NULL;
