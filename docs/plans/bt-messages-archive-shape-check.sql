-- READ ONLY. Confirms the legacy Buildertrend archive shape that
-- scripts/import-buildertrend-messages.mjs assumes before its first apply
-- (see docs/plans/bt-messages-live-conversations.md):
--   channels  `bt-message-archive-<jobId>`
--   messages  `bt-message-<jobId>-<btMessageId>` inside their job's archive channel
--   copies    `bt-owner-history-<jobId>-<btMessageId>` in `project-owner-<projectId>`
-- SELECT statements only, no bound parameters, and no message text, names or
-- emails: counts, id patterns and channel ids. Each query is independent.
-- `substr(id, 20)` is the job id after 'bt-message-archive-' (19 characters).

-- 1. Archive channels: how many, and their settings.
SELECT 'archive_channels' AS check_name, COUNT(*) AS n,
  SUM(project_id IS NULL) AS without_project,
  SUM(archived_at IS NOT NULL) AS already_archived,
  SUM(is_private = 1) AS private_channels,
  COUNT(DISTINCT audience) AS distinct_audiences,
  MIN(audience) AS min_audience, MAX(audience) AS max_audience,
  SUM(substr(id, 20) = '' OR substr(id, 20) GLOB '*[^0-9]*') AS job_id_not_numeric
FROM channels WHERE id LIKE 'bt-message-archive-%';

-- 2. Archive channels whose project is in another organization (must be 0).
SELECT 'archive_channel_org_mismatch' AS check_name, COUNT(*) AS n
FROM channels c JOIN projects p ON p.id = c.project_id
WHERE c.id LIKE 'bt-message-archive-%' AND p.organization_id <> c.organization_id;

-- 3. Messages in archive channels by id shape:
--    legacy = 'bt-message-<same jobId>-<btMessageId>', top level;
--    other  = anything else (staff replies written in Compass, other imports).
SELECT 'archive_message_shapes' AS check_name,
  COUNT(*) AS total,
  SUM(m.id LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%' AND m.thread_id IS NULL) AS legacy_top_level,
  SUM(m.id LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%' AND m.thread_id IS NOT NULL) AS legacy_as_reply,
  SUM(m.id NOT LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%' AND m.thread_id IS NOT NULL) AS other_replies,
  SUM(m.id NOT LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%' AND m.thread_id IS NULL) AS other_top_level,
  SUM(m.deleted_at IS NOT NULL) AS deleted,
  COUNT(DISTINCT m.user_id) AS distinct_authors
FROM messages m WHERE m.channel_id LIKE 'bt-message-archive-%';

-- 4. Legacy rows whose job id does not match their channel (must be 0).
SELECT 'legacy_row_in_wrong_archive' AS check_name, COUNT(*) AS n
FROM messages m
WHERE m.id LIKE 'bt-message-%' AND m.id NOT LIKE 'bt-message-archive-%'
  AND m.channel_id LIKE 'bt-message-archive-%'
  AND m.id NOT LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%';

-- 5. Legacy-shaped rows outside any archive channel (expected 0).
SELECT 'legacy_row_outside_archive' AS check_name, COUNT(*) AS n
FROM messages WHERE id LIKE 'bt-message-%' AND channel_id NOT LIKE 'bt-message-archive-%';

-- 6. Legacy rows with staff thread replies: these stay in the archive unless
--    their thread is staff-only (per channel, count only).
SELECT m.channel_id, COUNT(*) AS legacy_rows_with_replies, SUM(m.reply_count) AS replies
FROM messages m
WHERE m.channel_id LIKE 'bt-message-archive-%' AND m.thread_id IS NULL
  AND EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id)
GROUP BY m.channel_id ORDER BY m.channel_id;

-- 7. Per archive channel: message counts (used to size batches and to compare
--    with the capture's per-job counts).
SELECT m.channel_id, COUNT(*) AS messages, SUM(m.thread_id IS NULL) AS top_level,
  MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
FROM messages m WHERE m.channel_id LIKE 'bt-message-archive-%'
GROUP BY m.channel_id ORDER BY m.channel_id;

-- 8. BT message id suffixes that appear in more than one legacy row (must be 0).
SELECT 'duplicate_legacy_suffix' AS check_name, COUNT(*) AS n FROM (
  SELECT substr(m.id, length('bt-message-' || substr(m.channel_id, 20) || '-') + 1) AS bt_message_id
  FROM messages m
  WHERE m.channel_id LIKE 'bt-message-archive-%' AND m.id LIKE 'bt-message-' || substr(m.channel_id, 20) || '-%'
  GROUP BY 1 HAVING COUNT(*) > 1
);

-- 9. Owner-history copies: where they live and whether their source row exists.
SELECT 'owner_history_copies' AS check_name, COUNT(*) AS total,
  SUM(h.channel_id LIKE 'project-owner-%') AS in_owner_channel,
  SUM(EXISTS (SELECT 1 FROM messages s WHERE s.id = 'bt-message-' || substr(h.id, length('bt-owner-history-') + 1))) AS source_row_present,
  SUM(EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = h.id)) AS with_replies
FROM messages h WHERE h.id LIKE 'bt-owner-history-%';

-- 10. Owner-history copies in a channel of another project than their source (must be 0).
SELECT 'owner_history_project_mismatch' AS check_name, COUNT(*) AS n
FROM messages h
JOIN channels hc ON hc.id = h.channel_id
JOIN messages s ON s.id = 'bt-message-' || substr(h.id, length('bt-owner-history-') + 1)
JOIN channels sc ON sc.id = s.channel_id
WHERE h.id LIKE 'bt-owner-history-%' AND hc.project_id IS NOT sc.project_id;

-- 11. Archive attachments (count only; they move with their message row).
SELECT 'archive_attachments' AS check_name, COUNT(*) AS n,
  SUM(a.content_sha256 IS NOT NULL) AS with_hash
FROM message_attachments a JOIN messages m ON m.id = a.message_id
WHERE m.channel_id LIKE 'bt-message-archive-%';

-- 12. Nothing imported yet (all 0 before the first apply; needs migration 0287).
SELECT 'already_imported' AS check_name,
  (SELECT COUNT(*) FROM messages WHERE source_system IS NOT NULL) AS messages,
  (SELECT COUNT(*) FROM channels WHERE source_system IS NOT NULL) AS channels;

-- 13. Projects already marked staff-only for imported conversations (ids only).
SELECT id FROM projects WHERE imported_conversations_staff_only = 1 ORDER BY id;
