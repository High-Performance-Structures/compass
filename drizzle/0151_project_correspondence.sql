-- Additive, opt-in correspondence. Existing channels and source archives remain intact.
CREATE TABLE project_correspondence (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id), subject TEXT NOT NULL,
 participant_version INTEGER NOT NULL DEFAULT 1, closed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX correspondence_project_idx ON project_correspondence(organization_id, project_id);
CREATE TABLE correspondence_participants (
 id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
 user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('staff','owner','sub_vendor')), revoked_at TEXT
);
CREATE UNIQUE INDEX correspondence_participant_unique ON correspondence_participants(conversation_id,user_id);
CREATE TABLE correspondence_messages (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
 author_user_id TEXT REFERENCES users(id), author_name TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('compass','buildertrend','email','sms')), source_key TEXT UNIQUE,
 body TEXT NOT NULL, sent_at TEXT NOT NULL, edited_at TEXT, retracted_at TEXT, request_hash TEXT NOT NULL
);
CREATE INDEX correspondence_message_order_idx ON correspondence_messages(conversation_id,sequence);
CREATE TABLE correspondence_recipients (
 id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL REFERENCES correspondence_messages(id),
 user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('author','to','cc')), opened_at TEXT, baseline INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX correspondence_recipient_unique ON correspondence_recipients(message_id,user_id);
CREATE INDEX correspondence_recipient_user_idx ON correspondence_recipients(user_id,message_id);
CREATE TABLE correspondence_user_state (
 id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
 user_id TEXT NOT NULL REFERENCES users(id), saved INTEGER NOT NULL DEFAULT 0,
 follow_up INTEGER NOT NULL DEFAULT 0, share_read_receipts INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX correspondence_state_unique ON correspondence_user_state(conversation_id,user_id);
CREATE TABLE correspondence_drafts (
 id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
 user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_draft_unique ON correspondence_drafts(conversation_id,user_id);
CREATE TABLE correspondence_attachments (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id), message_id TEXT REFERENCES correspondence_messages(id),
 name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size >= 0), drive_file_id TEXT, retired_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX correspondence_attachments_message_idx ON correspondence_attachments(message_id);
CREATE TABLE correspondence_revisions (
 id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL REFERENCES correspondence_messages(id),
 actor_user_id TEXT NOT NULL, previous_body TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('edit','retract')), created_at TEXT NOT NULL
);
CREATE TABLE correspondence_outbox (
 id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL REFERENCES correspondence_messages(id),
 recipient_user_id TEXT NOT NULL, transport TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_outbox_unique ON correspondence_outbox(message_id,recipient_user_id,transport);
CREATE TABLE correspondence_write_guards (id TEXT PRIMARY KEY NOT NULL, allowed INTEGER NOT NULL CHECK(allowed = 1));
CREATE TABLE correspondence_composition_drafts (
 id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
 user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL, body TEXT NOT NULL,
 recipient_user_ids TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_composition_draft_unique ON correspondence_composition_drafts(project_id,user_id);
