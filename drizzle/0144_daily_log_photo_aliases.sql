-- Additive read-model alias schema for verified duplicate photo content.
-- RESTRICT preserves source provenance and direct-id addressability.
CREATE TABLE daily_log_photo_aliases (
  source_photo_id TEXT PRIMARY KEY NOT NULL REFERENCES daily_log_photos(id) ON DELETE RESTRICT,
  canonical_photo_id TEXT NOT NULL REFERENCES daily_log_photos(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9A-Fa-f]*'),
  content_size_bytes INTEGER NOT NULL CHECK(content_size_bytes >= 0),
  adjudication TEXT NOT NULL DEFAULT 'verified_sha256',
  created_at TEXT NOT NULL,
  CHECK(source_photo_id <> canonical_photo_id)
);
--> statement-breakpoint
CREATE INDEX idx_daily_log_photo_aliases_project_canonical
  ON daily_log_photo_aliases(project_id, canonical_photo_id);
--> statement-breakpoint
CREATE INDEX idx_daily_log_photo_aliases_content
  ON daily_log_photo_aliases(project_id, content_sha256, content_size_bytes);
--> statement-breakpoint
CREATE TRIGGER daily_log_photo_aliases_project_scope_insert
BEFORE INSERT ON daily_log_photo_aliases
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM daily_log_photos AS source
  JOIN daily_log_photos AS canonical
    ON canonical.id IS NEW.canonical_photo_id
  WHERE source.id IS NEW.source_photo_id
    AND source.project_id IS NEW.project_id
    AND canonical.project_id IS NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Daily log photo alias project scope mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER daily_log_photo_aliases_project_scope_update
BEFORE UPDATE OF source_photo_id, canonical_photo_id, project_id
ON daily_log_photo_aliases
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM daily_log_photos AS source
  JOIN daily_log_photos AS canonical
    ON canonical.id IS NEW.canonical_photo_id
  WHERE source.id IS NEW.source_photo_id
    AND source.project_id IS NEW.project_id
    AND canonical.project_id IS NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Daily log photo alias project scope mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER daily_log_photo_aliases_photo_project_scope_update
BEFORE UPDATE OF project_id ON daily_log_photos
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM daily_log_photo_aliases AS alias
  WHERE alias.project_id IS NOT NEW.project_id
    AND (
      alias.source_photo_id IS OLD.id
      OR alias.canonical_photo_id IS OLD.id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Daily log photo project move would break alias scope');
END;
