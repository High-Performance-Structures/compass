ALTER TABLE project_access_invitations ADD COLUMN email_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE project_access_invitations ADD COLUMN email_subject TEXT;
ALTER TABLE project_access_invitations ADD COLUMN email_message TEXT;
ALTER TABLE project_access_invitations ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_access_invitations ADD COLUMN email_next_attempt_at TEXT;
ALTER TABLE project_access_invitations ADD COLUMN email_claim_token TEXT;
ALTER TABLE project_access_invitations ADD COLUMN email_claimed_at TEXT;
ALTER TABLE project_access_invitations ADD COLUMN email_sent_at TEXT;
-- Historical failures have no saved message. Surface them for deliberate staff recovery.
UPDATE project_access_invitations SET email_status = CASE
  WHEN email_provider_message_id IS NOT NULL AND email_error IS NULL THEN 'sent'
  WHEN email_error IS NOT NULL THEN 'failed'
  ELSE 'unknown' END;
CREATE INDEX idx_project_access_invites_email_dispatch
  ON project_access_invitations(email_status, email_next_attempt_at);
CREATE UNIQUE INDEX idx_project_access_invites_one_queued_welcome
  ON project_access_invitations(project_id, project_contact_id)
  WHERE email_status IN ('queued', 'retrying', 'sending') AND project_contact_id IS NOT NULL;
CREATE TABLE email_mailbox_state (
  mailbox TEXT PRIMARY KEY NOT NULL,
  next_allowed_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT NOT NULL
);
