-- Pay application G703 rows split by estimate assembly (or change order),
-- so a draw can be billed and shown by assembly. Null = no assembly.
ALTER TABLE `project_budget_lines` ADD `assembly_key` text;
ALTER TABLE `project_budget_lines` ADD `assembly_name` text;
ALTER TABLE `project_budget_lines` ADD `assembly_sort` integer DEFAULT 0 NOT NULL;
