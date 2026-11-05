-- Ordering priority: a person's chosen order for a company's purchase orders
-- (and, later, RFQs or RFIs, which share project_operations). One rank per
-- row, compared only among rows of the same record type in the same
-- organization (through the row's project). Lower ranks come first; rows
-- without a rank sort after ranked rows by creation date, so new rows land
-- at the bottom. Additive only: one nullable column and one partial index.
ALTER TABLE `project_operations` ADD COLUMN `priority_rank` integer;
--> statement-breakpoint
CREATE INDEX `project_operations_priority_rank_idx` ON `project_operations` (`source_record_type`,`priority_rank`) WHERE `priority_rank` IS NOT NULL;
