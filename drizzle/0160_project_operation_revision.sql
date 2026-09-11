ALTER TABLE `project_operations` ADD COLUMN `revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `project_operations_revision_after_update`
AFTER UPDATE ON `project_operations`
FOR EACH ROW
WHEN NEW.`revision` = OLD.`revision`
BEGIN
  UPDATE `project_operations`
  SET `revision` = OLD.`revision` + 1
  WHERE `id` = OLD.`id`;
END;
