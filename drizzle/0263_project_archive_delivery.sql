-- Recipient-scoped historical reading editions. Existing construction publications are unchanged.
CREATE TABLE project_archive_documents (
 id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 kind TEXT NOT NULL CHECK(kind IN ('daily_log','message','owner_update','rfi','rfq','other')),
 period TEXT NOT NULL CHECK(length(trim(period)) BETWEEN 1 AND 120),
 audience TEXT NOT NULL CHECK(audience IN ('owner','sub_vendor')),
 source_system TEXT NOT NULL DEFAULT 'buildertrend' CHECK(source_system='buildertrend'),
 source_record_ids TEXT NOT NULL CHECK(json_valid(source_record_ids) AND json_type(source_record_ids)='array' AND json_array_length(source_record_ids)>0),
 source_audience_evidence TEXT NOT NULL CHECK(length(trim(source_audience_evidence)) BETWEEN 10 AND 2000),
 drive_file_id TEXT NOT NULL,
 file_name TEXT NOT NULL,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=20971520),
 page_count INTEGER NOT NULL CHECK(page_count>0),
 status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','revoked')),
 published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 published_at TEXT NOT NULL,
 revoked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 revoked_at TEXT,
 revoke_reason TEXT,
 restored_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 restored_at TEXT,
 CHECK(status!='revoked' OR (revoked_at IS NOT NULL AND length(trim(revoke_reason))>0))
);
--> statement-breakpoint
CREATE INDEX project_archive_project_status_idx ON project_archive_documents(project_id,status);
CREATE UNIQUE INDEX project_archive_file_audience_uq ON project_archive_documents(project_id,drive_file_id,audience);
CREATE TABLE project_archive_recipients (
 archive_id TEXT NOT NULL REFERENCES project_archive_documents(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(archive_id,user_id)
);
--> statement-breakpoint
CREATE TRIGGER project_archive_source_ids_insert BEFORE INSERT ON project_archive_documents
WHEN EXISTS (SELECT 1 FROM json_each(NEW.source_record_ids) WHERE type!='text' OR length(trim(value))=0)
BEGIN SELECT RAISE(ABORT,'Archive source IDs must be nonempty strings'); END;
--> statement-breakpoint
CREATE TRIGGER project_archive_scope_insert BEFORE INSERT ON project_archive_documents
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'Archive project organization mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER project_archive_identity_immutable BEFORE UPDATE ON project_archive_documents
WHEN NEW.id!=OLD.id OR NEW.project_id!=OLD.project_id OR NEW.organization_id!=OLD.organization_id
 OR NEW.title!=OLD.title OR NEW.kind!=OLD.kind OR NEW.period!=OLD.period OR NEW.audience!=OLD.audience
 OR NEW.source_system!=OLD.source_system OR NEW.source_record_ids!=OLD.source_record_ids
 OR NEW.source_audience_evidence!=OLD.source_audience_evidence OR NEW.drive_file_id!=OLD.drive_file_id
 OR NEW.file_name!=OLD.file_name OR NEW.sha256!=OLD.sha256 OR NEW.byte_size!=OLD.byte_size
 OR NEW.page_count!=OLD.page_count OR NEW.published_at!=OLD.published_at
BEGIN SELECT RAISE(ABORT,'Published archive identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER project_archive_recipient_immutable BEFORE UPDATE ON project_archive_recipients
BEGIN SELECT RAISE(ABORT,'Archive recipient identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER project_archive_recipient_scope BEFORE INSERT ON project_archive_recipients
WHEN NOT EXISTS (
 SELECT 1 FROM project_archive_documents d
 JOIN users u ON u.id=NEW.user_id AND u.is_active=1
 JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id
 JOIN organizations o ON o.id=p.organization_id AND o.is_active=1
 JOIN organization_members om ON om.organization_id=o.id AND om.user_id=u.id AND om.role IN ('client','subcontractor','supplier','guest')
 JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=u.id
 WHERE d.id=NEW.archive_id AND ((d.audience='owner' AND pm.role IN ('owner','client')) OR (d.audience='sub_vendor' AND pm.role IN ('subcontractor','supplier')))
)
BEGIN SELECT RAISE(ABORT,'Archive recipient has no matching active project access'); END;
