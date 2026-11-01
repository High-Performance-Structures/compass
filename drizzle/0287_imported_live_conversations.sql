-- Imported (Buildertrend) messages become normal, replyable project
-- conversations. Additive only: new nullable columns and indexes, no data
-- changes, no table rebuilds. See docs/plans/bt-messages-live-conversations.md.

-- Per-project switch: imported conversations on this project stay visible to
-- internal staff only (for example a project under a legal hold). Off by
-- default; staff change it on the project's Information page.
ALTER TABLE `projects` ADD COLUMN `imported_conversations_staff_only` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- A conversation created from an outside system's thread. The pair is the
-- import key, so re-running an import never creates the same conversation twice.
ALTER TABLE `channels` ADD COLUMN `source_system` text;
--> statement-breakpoint
ALTER TABLE `channels` ADD COLUMN `source_thread_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `channels_source_thread_unique`
  ON `channels` (`organization_id`, `source_system`, `source_thread_id`)
  WHERE `source_thread_id` IS NOT NULL;
--> statement-breakpoint

-- A message imported from an outside system. `source_message_id` is the
-- idempotency key; `source_sent_at_snapshot` keeps the sent date exactly as
-- the source displayed it (its time zone is often not shown).
-- `imported_sender_contact_id` is set only while the original sender is a
-- directory contact without a Compass account; when that person is given
-- access the message is re-pointed to their account and this is cleared.
ALTER TABLE `messages` ADD COLUMN `source_system` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `source_message_id` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `source_sent_at_snapshot` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `imported_sender_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `messages_source_message_unique`
  ON `messages` (`source_system`, `source_message_id`)
  WHERE `source_message_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_imported_sender_contact_idx`
  ON `messages` (`imported_sender_contact_id`);
--> statement-breakpoint

-- Attachments carry their content hash so an import reuses a stored file with
-- the same bytes instead of keeping a second copy.
ALTER TABLE `message_attachments` ADD COLUMN `content_sha256` text;
--> statement-breakpoint
ALTER TABLE `message_attachments` ADD COLUMN `source_attachment_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_attachments_content_sha256_idx`
  ON `message_attachments` (`content_sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `message_attachments_source_unique`
  ON `message_attachments` (`message_id`, `source_attachment_id`)
  WHERE `source_attachment_id` IS NOT NULL;
