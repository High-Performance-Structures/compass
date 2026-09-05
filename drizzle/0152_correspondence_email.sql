-- Durable email transport records are opt-in and additive. Provider events are
-- immutable enough for duplicate suppression; delivery status never implies read.
CREATE TABLE correspondence_email_threads (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
  reply_token TEXT NOT NULL,
  reply_to_address TEXT NOT NULL,
  anchor_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_email_thread_conversation_unique ON correspondence_email_threads(conversation_id);
CREATE UNIQUE INDEX correspondence_email_thread_token_unique ON correspondence_email_threads(reply_token);
CREATE UNIQUE INDEX correspondence_email_thread_anchor_unique ON correspondence_email_threads(anchor_message_id);
CREATE INDEX correspondence_email_thread_project_idx ON correspondence_email_threads(organization_id, project_id);

CREATE TABLE correspondence_email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  conversation_id TEXT NOT NULL REFERENCES project_correspondence(id),
  message_id TEXT NOT NULL REFERENCES correspondence_messages(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gmail',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','dispatching','accepted','failed','unknown')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  queued_at TEXT NOT NULL,
  accepted_at TEXT,
  failed_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_email_delivery_unique ON correspondence_email_deliveries(message_id, recipient_user_id, provider);
CREATE INDEX correspondence_email_delivery_dispatch_idx ON correspondence_email_deliveries(status, queued_at);

CREATE TABLE correspondence_email_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  conversation_id TEXT REFERENCES project_correspondence(id),
  message_id TEXT REFERENCES correspondence_messages(id),
  sender_address TEXT,
  status TEXT NOT NULL CHECK(status IN ('posted','held','suppressed','rejected')),
  hold_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX correspondence_email_event_provider_unique ON correspondence_email_events(provider, provider_event_id);
CREATE INDEX correspondence_email_event_project_idx ON correspondence_email_events(organization_id, project_id, created_at);
