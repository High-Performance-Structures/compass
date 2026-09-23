-- A source schedule record and an editable Compass task are separate records.
-- The target ID snapshot survives authorized task deletion.
CREATE TABLE buildertrend_schedule_task_source_links (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_record_id text NOT NULL REFERENCES buildertrend_staging_records(id) ON DELETE RESTRICT,
  schedule_task_id text REFERENCES schedule_tasks(id) ON DELETE SET NULL,
  schedule_task_id_snapshot text NOT NULL,
  linked_at text NOT NULL,
  target_deleted_at text
);
--> statement-breakpoint
CREATE UNIQUE INDEX buildertrend_schedule_task_source_pair_unique
  ON buildertrend_schedule_task_source_links (source_record_id, schedule_task_id_snapshot);
--> statement-breakpoint
CREATE INDEX buildertrend_schedule_task_source_project_idx
  ON buildertrend_schedule_task_source_links (organization_id, project_id);
--> statement-breakpoint
CREATE INDEX buildertrend_schedule_task_source_task_idx
  ON buildertrend_schedule_task_source_links (schedule_task_id);
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_insert_scope
BEFORE INSERT ON buildertrend_schedule_task_source_links
WHEN NEW.schedule_task_id IS NULL
  OR NEW.schedule_task_id_snapshot IS NOT NEW.schedule_task_id
  OR NEW.target_deleted_at IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM projects project
    JOIN buildertrend_staging_records source ON source.id = NEW.source_record_id
    JOIN schedule_tasks task ON task.id = NEW.schedule_task_id
    WHERE project.id = NEW.project_id
      AND project.organization_id = NEW.organization_id
      AND source.organization_id = NEW.organization_id
      AND source.project_id = NEW.project_id
      AND source.source_record_type IN ('schedule_item', 'schedule_task')
      AND source.promotion_status = 'promoted'
      AND source.promoted_record_type = 'schedule_task'
      AND source.promoted_record_id = NEW.schedule_task_id
      AND task.project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend schedule source link scope mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_update_guard
BEFORE UPDATE ON buildertrend_schedule_task_source_links
WHEN NEW.id IS NOT OLD.id
  OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.source_record_id IS NOT OLD.source_record_id
  OR NEW.schedule_task_id_snapshot IS NOT OLD.schedule_task_id_snapshot
  OR NEW.linked_at IS NOT OLD.linked_at
  OR (
    (NEW.schedule_task_id IS NOT OLD.schedule_task_id
      OR NEW.target_deleted_at IS NOT OLD.target_deleted_at)
    AND NOT (
      OLD.schedule_task_id IS NOT NULL
      AND NEW.schedule_task_id IS NULL
      AND NEW.target_deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM schedule_tasks WHERE id = OLD.schedule_task_id
      )
    )
    AND NOT (
      OLD.schedule_task_id IS NULL
      AND NEW.schedule_task_id IS NULL
      AND OLD.target_deleted_at IS NULL
      AND NEW.target_deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM schedule_tasks WHERE id = OLD.schedule_task_id_snapshot
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend schedule source link history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_delete_guard
BEFORE DELETE ON buildertrend_schedule_task_source_links
BEGIN
  SELECT RAISE(ABORT, 'Buildertrend schedule source link history cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_source_guard
BEFORE UPDATE OF organization_id, project_id, source_record_type,
  promotion_status, promoted_record_type, promoted_record_id
ON buildertrend_staging_records
WHEN EXISTS (
  SELECT 1 FROM buildertrend_schedule_task_source_links link
  WHERE link.source_record_id = OLD.id
    AND (
      NEW.organization_id IS NOT link.organization_id
      OR NEW.project_id IS NOT link.project_id
      OR NEW.source_record_type NOT IN ('schedule_item', 'schedule_task')
      OR NEW.promoted_record_type IS NOT 'schedule_task'
      OR NEW.promoted_record_id IS NOT link.schedule_task_id_snapshot
      OR (
        NEW.promotion_status IS NOT OLD.promotion_status
        AND NOT (
          link.schedule_task_id IS NULL
          AND link.target_deleted_at IS NOT NULL
          AND OLD.promotion_status = 'promoted'
          AND NEW.promotion_status = 'archive_only'
        )
      )
      OR (link.schedule_task_id IS NOT NULL AND NEW.promotion_status IS NOT 'promoted')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Linked Buildertrend schedule source cannot change scope');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_task_guard
BEFORE UPDATE OF project_id ON schedule_tasks
WHEN EXISTS (
  SELECT 1 FROM buildertrend_schedule_task_source_links link
  WHERE link.schedule_task_id = OLD.id
    AND NEW.project_id IS NOT link.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Linked Compass schedule task cannot change project');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_project_guard
BEFORE UPDATE OF organization_id ON projects
WHEN EXISTS (
  SELECT 1 FROM buildertrend_schedule_task_source_links link
  WHERE link.project_id = OLD.id
    AND NEW.organization_id IS NOT link.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'Linked Compass project cannot change organization');
END;
--> statement-breakpoint
CREATE TRIGGER buildertrend_schedule_task_source_task_deleted
AFTER DELETE ON schedule_tasks
BEGIN
  UPDATE buildertrend_schedule_task_source_links
  SET target_deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE schedule_task_id IS NULL
    AND schedule_task_id_snapshot = OLD.id
    AND target_deleted_at IS NULL;
  UPDATE buildertrend_staging_records
  SET promotion_status = 'archive_only',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (
    SELECT source_record_id
    FROM buildertrend_schedule_task_source_links
    WHERE schedule_task_id_snapshot = OLD.id
      AND target_deleted_at IS NOT NULL
  )
    AND promotion_status = 'promoted';
END;
