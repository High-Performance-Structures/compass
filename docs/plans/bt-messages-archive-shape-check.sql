-- READ ONLY. Confirms the legacy Buildertrend archive shape that
-- scripts/import-buildertrend-messages.mjs assumes, and produces the
-- importer's pre-check file (see docs/plans/bt-messages-live-conversations.md):
--   converted   `bt-message-archive-<digits>` channels holding
--               `bt-message-<digits>-<digits>` rows
--   untouched   `bt-message-archive-estimate-*` and any other archive name
--   copies      `bt-owner-history-<jobId>-<btMessageId>` in `project-owner-<projectId>`
-- SELECT statements only, no bound parameters, and no message text, names or
-- emails: counts, id patterns and channel/project ids. Each query is
-- independent. `substr(id, 20)` is what follows 'bt-message-archive-' (19 chars).
--
-- PART A runs before or after migration 0287.
-- PART B needs migration 0287 (new columns); RUN IT ONLY AFTER 0287.

-- ===========================================================================
-- PART A: any time
-- ===========================================================================

-- A1. Archive channels by kind: numeric (converted) vs other names (untouched).
SELECT CASE WHEN substr(id, 20) GLOB '[0-9]*' AND substr(id, 20) NOT GLOB '*[^0-9]*' THEN 'numeric'
            WHEN id LIKE 'bt-message-archive-estimate-%' THEN 'estimate'
            ELSE 'other' END AS kind,
  COUNT(*) AS channels,
  SUM(project_id IS NULL) AS without_project,
  SUM(archived_at IS NOT NULL) AS already_archived,
  SUM(is_private = 1) AS private_channels,
  MIN(audience) AS min_audience, MAX(audience) AS max_audience
FROM channels WHERE id LIKE 'bt-message-archive-%' GROUP BY 1 ORDER BY 1;

-- A2. Archive channels whose project is in another organization (must be 0).
SELECT 'archive_channel_org_mismatch' AS check_name, COUNT(*) AS n
FROM channels c JOIN projects p ON p.id = c.project_id
WHERE c.id LIKE 'bt-message-archive-%' AND p.organization_id <> c.organization_id;

-- A3. Rows in NUMERIC archives by id shape. legacy = 'bt-message-<same job>-<digits>'.
SELECT 'numeric_archive_rows' AS check_name, COUNT(*) AS total,
  SUM(m.id GLOB 'bt-message-' || substr(m.channel_id, 20) || '-[0-9]*'
      AND substr(m.id, length('bt-message-' || substr(m.channel_id, 20) || '-') + 1) NOT GLOB '*[^0-9]*'
      AND m.thread_id IS NULL) AS legacy_top_level,
  SUM(m.thread_id IS NOT NULL) AS replies,
  SUM(NOT (m.id GLOB 'bt-message-' || substr(m.channel_id, 20) || '-[0-9]*'
      AND substr(m.id, length('bt-message-' || substr(m.channel_id, 20) || '-') + 1) NOT GLOB '*[^0-9]*')
      AND m.thread_id IS NULL) AS other_top_level,
  SUM(m.deleted_at IS NOT NULL) AS deleted,
  COUNT(DISTINCT m.user_id) AS distinct_authors
FROM messages m
WHERE m.channel_id GLOB 'bt-message-archive-[0-9]*' AND substr(m.channel_id, 20) NOT GLOB '*[^0-9]*';

-- A4. The non-legacy rows inside numeric archives: id prefix and placement only
--     (these stay in the staff-only archive; the archive is not retired).
SELECT m.channel_id, substr(m.id, 1, 24) AS id_prefix, m.thread_id IS NOT NULL AS is_reply, m.created_at
FROM messages m
WHERE m.channel_id GLOB 'bt-message-archive-[0-9]*' AND substr(m.channel_id, 20) NOT GLOB '*[^0-9]*'
  AND NOT (m.id GLOB 'bt-message-' || substr(m.channel_id, 20) || '-[0-9]*'
       AND substr(m.id, length('bt-message-' || substr(m.channel_id, 20) || '-') + 1) NOT GLOB '*[^0-9]*')
ORDER BY m.channel_id;

-- A5. Legacy-shaped rows outside their numeric archive (must be 0).
SELECT 'legacy_row_outside_its_archive' AS check_name, COUNT(*) AS n
FROM messages m
WHERE m.id GLOB 'bt-message-[0-9]*-[0-9]*'
  AND m.channel_id <> 'bt-message-archive-' || substr(m.id, 12, instr(substr(m.id, 12), '-') - 1);

-- A6. Legacy rows that already have staff thread replies (count per channel).
SELECT m.channel_id, COUNT(*) AS legacy_rows_with_replies
FROM messages m
WHERE m.channel_id GLOB 'bt-message-archive-[0-9]*' AND m.thread_id IS NULL
  AND EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = m.id)
GROUP BY m.channel_id ORDER BY m.channel_id;

-- A7. Per numeric archive: job id, project, privacy and message counts.
SELECT substr(c.id, 20) AS bt_job_id, c.project_id, c.is_private,
  COUNT(m.id) AS messages, MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at
FROM channels c LEFT JOIN messages m ON m.channel_id = c.id
WHERE c.id GLOB 'bt-message-archive-[0-9]*' AND substr(c.id, 20) NOT GLOB '*[^0-9]*'
GROUP BY c.id ORDER BY c.id;

-- A8. Pre-check input: job ids whose numeric archive is PRIVATE
--     (-> precheck.json "privateArchiveJobIds").
SELECT substr(id, 20) AS bt_job_id FROM channels
WHERE id GLOB 'bt-message-archive-[0-9]*' AND substr(id, 20) NOT GLOB '*[^0-9]*' AND is_private = 1
ORDER BY 1;

-- A9. BT message ids that appear in more than one legacy row (must be 0).
SELECT 'duplicate_legacy_suffix' AS check_name, COUNT(*) AS n FROM (
  SELECT substr(m.id, length('bt-message-' || substr(m.channel_id, 20) || '-') + 1) AS bt_message_id
  FROM messages m
  WHERE m.channel_id GLOB 'bt-message-archive-[0-9]*' AND m.id GLOB 'bt-message-' || substr(m.channel_id, 20) || '-[0-9]*'
  GROUP BY 1 HAVING COUNT(*) > 1
);

-- A10. Owner-history copies: placement, source row present, replies.
SELECT 'owner_history_copies' AS check_name, COUNT(*) AS total,
  SUM(h.channel_id LIKE 'project-owner-%') AS in_owner_channel,
  SUM(EXISTS (SELECT 1 FROM messages s WHERE s.id = 'bt-message-' || substr(h.id, length('bt-owner-history-') + 1))) AS source_row_present,
  SUM(EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = h.id)) AS with_replies
FROM messages h WHERE h.id LIKE 'bt-owner-history-%';

-- A11. Owner-history copies in another project's channel than their source (must be 0).
SELECT 'owner_history_project_mismatch' AS check_name, COUNT(*) AS n
FROM messages h
JOIN channels hc ON hc.id = h.channel_id
JOIN messages s ON s.id = 'bt-message-' || substr(h.id, length('bt-owner-history-') + 1)
JOIN channels sc ON sc.id = s.channel_id
WHERE h.id LIKE 'bt-owner-history-%' AND hc.project_id IS NOT sc.project_id;

-- A12. The estimate archives (never converted): count and dates only.
SELECT 'estimate_archives' AS check_name, COUNT(DISTINCT c.id) AS channels, COUNT(m.id) AS messages,
  MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at, COUNT(DISTINCT c.project_id) AS projects
FROM channels c LEFT JOIN messages m ON m.channel_id = c.id
WHERE c.id LIKE 'bt-message-archive-estimate-%';

-- ===========================================================================
-- PART B: RUN ONLY AFTER MIGRATION 0287 (uses its new columns)
-- ===========================================================================

-- B1 (after 0287). Pre-check input: projects whose imported conversations are
--     staff-only (-> precheck.json "staffOnlyProjectIds"). The legal-hold
--     project MUST be listed here before any batch is applied.
SELECT id FROM projects WHERE imported_conversations_staff_only = 1 ORDER BY id;

-- B2 (after 0287). Project of each numeric archive with its staff-only switch,
--     to confirm the legal-hold job's project before the first apply.
SELECT substr(c.id, 20) AS bt_job_id, c.project_id, p.imported_conversations_staff_only
FROM channels c JOIN projects p ON p.id = c.project_id
WHERE c.id GLOB 'bt-message-archive-[0-9]*' AND substr(c.id, 20) NOT GLOB '*[^0-9]*'
ORDER BY 1;

-- B3 (after 0287). Archive attachments (count only; they move with their row).
SELECT 'archive_attachments' AS check_name, COUNT(*) AS n,
  SUM(a.content_sha256 IS NOT NULL) AS with_hash
FROM message_attachments a JOIN messages m ON m.id = a.message_id
WHERE m.channel_id LIKE 'bt-message-archive-%';

-- B4 (after 0287). Nothing imported yet (all 0 before the first apply).
SELECT 'already_imported' AS check_name,
  (SELECT COUNT(*) FROM messages WHERE source_system IS NOT NULL) AS messages,
  (SELECT COUNT(*) FROM channels WHERE source_system IS NOT NULL) AS channels;
