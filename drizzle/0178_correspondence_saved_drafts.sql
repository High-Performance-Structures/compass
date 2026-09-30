ALTER TABLE correspondence_drafts ADD COLUMN attachment_ids TEXT NOT NULL DEFAULT '[]';
CREATE TABLE correspondence_saved_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);
CREATE INDEX correspondence_saved_drafts_owner_idx ON correspondence_saved_drafts(organization_id, project_id, user_id);
INSERT INTO correspondence_saved_drafts(id, organization_id, project_id, user_id, content, version, updated_at)
SELECT id, organization_id, project_id, user_id,
  json_object('kind', 'message', 'subject', subject, 'body', body,
    'recipientUserIds', json(recipient_user_ids), 'attachmentIds', json('[]'), 'requestId', NULL),
  version, updated_at
FROM correspondence_composition_drafts
WHERE length(trim(subject)) > 0 OR length(trim(body)) > 0 OR json_array_length(recipient_user_ids) > 0;
