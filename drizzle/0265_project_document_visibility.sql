-- Per-audience visibility flags for published project documents.
-- Existing rows default to visible (they were shared project-wide); any
-- internal-only rows are hidden from both external audiences.
ALTER TABLE `project_documents` ADD `visible_to_owner` integer DEFAULT true NOT NULL;
ALTER TABLE `project_documents` ADD `visible_to_sub_vendor` integer DEFAULT true NOT NULL;
UPDATE `project_documents` SET `visible_to_owner` = false, `visible_to_sub_vendor` = false WHERE `audience` = 'internal_only';
