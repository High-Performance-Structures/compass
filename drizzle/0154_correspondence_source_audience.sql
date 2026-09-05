CREATE TABLE correspondence_source_messages (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
  message_id TEXT NOT NULL UNIQUE REFERENCES correspondence_messages(id),
  source_account_id TEXT NOT NULL CHECK(length(source_account_id) > 0),
  source_project_id TEXT NOT NULL CHECK(length(source_project_id) > 0),
  source_message_id TEXT NOT NULL CHECK(length(source_message_id) > 0),
  source_subject TEXT NOT NULL,
  source_sent_display TEXT NOT NULL,
  source_sent_local TEXT,
  source_sent_at TEXT,
  source_timezone TEXT,
  source_body_sha256 TEXT NOT NULL CHECK(length(source_body_sha256) = 64 AND source_body_sha256 NOT GLOB '*[^0-9A-Fa-f]*'),
  source_evidence_json TEXT NOT NULL CHECK(json_valid(source_evidence_json) = 1),
  captured_at TEXT NOT NULL,
  UNIQUE(source_account_id, source_message_id)
);
CREATE INDEX correspondence_source_messages_scope_idx ON correspondence_source_messages(organization_id, project_id, conversation_id);
CREATE TABLE correspondence_source_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  source_message_id TEXT NOT NULL REFERENCES correspondence_source_messages(id),
  source_recipient_key TEXT NOT NULL CHECK(length(source_recipient_key) > 0),
  source_user_id TEXT,
  source_name TEXT NOT NULL CHECK(length(source_name) > 0),
  source_email TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('author','to','cc','bcc')),
  source_ordinal INTEGER NOT NULL CHECK(source_ordinal >= 0),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) = 1),
  UNIQUE(source_message_id, source_recipient_key),
  UNIQUE(source_message_id, source_ordinal)
);
CREATE INDEX correspondence_source_recipients_message_idx ON correspondence_source_recipients(source_message_id, source_ordinal);
CREATE TRIGGER correspondence_source_messages_scope_insert
BEFORE INSERT ON correspondence_source_messages
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM correspondence_messages AS m
    JOIN project_correspondence AS c ON c.id = m.conversation_id
    WHERE m.id = NEW.message_id
      AND m.source = 'buildertrend'
      AND m.conversation_id = NEW.conversation_id
      AND c.organization_id = NEW.organization_id
      AND c.project_id = NEW.project_id
  ) THEN RAISE(ABORT, 'source message scope mismatch') END;
END;
CREATE TRIGGER correspondence_source_messages_immutable_update
BEFORE UPDATE ON correspondence_source_messages
BEGIN
  SELECT RAISE(ABORT, 'source message evidence is immutable');
END;
CREATE TRIGGER correspondence_source_messages_immutable_delete
BEFORE DELETE ON correspondence_source_messages
BEGIN
  SELECT RAISE(ABORT, 'source message evidence is immutable');
END;
CREATE TRIGGER correspondence_source_recipients_immutable_update
BEFORE UPDATE ON correspondence_source_recipients
BEGIN
  SELECT RAISE(ABORT, 'source recipient evidence is immutable');
END;
CREATE TRIGGER correspondence_source_recipients_immutable_delete
BEFORE DELETE ON correspondence_source_recipients
BEGIN
  SELECT RAISE(ABORT, 'source recipient evidence is immutable');
END;
