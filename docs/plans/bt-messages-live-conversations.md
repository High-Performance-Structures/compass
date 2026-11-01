# Buildertrend messages as live project conversations

Status: approved by the owner 2026-11-01. Design plus first implementation
(migration 0287, access rules, importer). Nothing here has been run against
production.

## Goal

Messages from Buildertrend (BT) live in Compass as normal, replyable project
conversations, exactly as if they had been written in Compass. Today they sit
in staff-only `bt-message-archive-<jobId>` channels where replies are allowed
only in threads and may mention only staff. After this work:

- each BT thread is one Compass project conversation with its original
  participants: staff plus the matched owner or vendor people;
- owners and vendors see their own threads, including people who do not have
  a Compass account yet; the threads are simply there when they first log in;
- replies work like any other conversation (staff in the app; owners and
  vendors in the app, or by replying to the normal notification email);
- the only visible difference is the shared `<SourceTag source="buildertrend" />`:
  a small, muted **`[BT]`** next to the timestamp (accessible name "Imported from Buildertrend"). Nothing is added
  to the message body, so a first login feels like a seamless continuation.

### Owner decisions (final)

1. BT participants who are not in the Compass directory are added as
   directory contacts **without** inviting them.
2. Owners and vendors may see their own imported threads before they have
   Compass access; the threads appear when they log in.
3. Existing `bt-message-archive-*` channels are **converted**: their messages
   move into the new conversations. No duplicate messages, no duplicate
   channels.
4. A project under a legal hold stays staff-only. This is a per-project
   setting, not a hard-coded id, because Compass is built for any company.

Further rules: the import sends no notifications and no email; it keeps the
original sender, recipients, sent date and attachments; people are matched
only by exact BT participant ids (never by name, initials or order), and
anyone unmatched goes to a review list; attachments are deduplicated by
sha256 (BT client-update photos are often the same bytes as daily-log
photos); the import is idempotent by BT message id.

## Data model (migration `0287_imported_live_conversations.sql`)

Additive only: nullable columns and indexes, no table rebuilds, no data
changes. Every column is declared in `src/db/schema.ts` and
`src/db/schema-conversations.ts`.

| Table | Column / index | Purpose |
|-------|----------------|---------|
| `projects` | `imported_conversations_staff_only` integer, default 0 | Per-project switch. On: imported conversations are staff-only (legal hold). Staff toggle it on the project's Information page. |
| `channels` | `source_system`, `source_thread_id` | Marks a conversation created from an outside thread. |
| `channels` | unique `(organization_id, source_system, source_thread_id)` where set | One conversation per BT thread, ever. |
| `messages` | `source_system`, `source_message_id` | Marks an imported message. |
| `messages` | unique `(source_system, source_message_id)` where set | Idempotency key: one row per BT message. |
| `messages` | `source_sent_at_snapshot` | The sent date exactly as BT displayed it. `created_at` holds the ISO instant used for ordering. |
| `messages` | `imported_sender_contact_id` → `project_contacts.id` (indexed) | Set only while the sender is a directory contact without an account. |
| `message_attachments` | `content_sha256` (indexed), `source_attachment_id` | Hash-based reuse; unique `(message_id, source_attachment_id)`. |

Existing tables are reused instead of adding parallel ones (architecture
standard: one concept, one table):

- **Participants** go in `project_source_record_participants`, which already
  exists as the authorization boundary for imported people. Thread rows use
  `source_record_type = 'buildertrend_message_thread'` and
  `source_record_id = <BT thread id>`; per-message rows use
  `'buildertrend_message'` with `participant_role` `sender`, `to` or `cc`.
  `source_participant_id` is the exact `namespace:participantId`.
- **New directory contacts** are `project_contacts` rows with
  `source_system = 'buildertrend'`,
  `source_entity_type = 'buildertrend_participant'`,
  `source_entity_id = <namespace:participantId>`, portal visibility off and no
  invitation.
- **Membership** is ordinary `channel_members` + `channel_read_state` (unread
  count 0).

### Sender of a message

`messages.user_id` is required. When the BT sender maps to a Compass account
the message is stored under that account. When the sender is only a
directory contact, the message is stored under the importing staff account
and `imported_sender_contact_id` points at the contact; every message read
selects the contact's name (`importedMessageColumns`) and the UI shows that
name and never treats it as the viewer's own message
(`messageSenderDisplay`). When that person is given access (invitation
accepted, or an existing account invited to the project),
`adoptImportedConversationsForContact` joins them to their imported
conversations and moves their messages onto their account
(`user_id` set, `imported_sender_contact_id` cleared). That step sends nothing.

## Audience and access

Each BT thread becomes a private conversation (`is_private = 1`) on its
project. Its audience comes from the mapped participants across the whole
thread:

| Participants besides staff | `channels.audience` | Who can open it |
|----------------------------|---------------------|-----------------|
| owners only | `clients` | all internal staff; owner members |
| vendors only | `sub_vendors` | all internal staff; vendor members |
| nobody | `staff` | all internal staff |
| owners **and** vendors | held for review | stays in the staff archive |

Rules (`canAccessImportedConversation` in
`src/lib/conversations/channel-access.ts`):

- Internal staff may open every imported conversation, as they could the old
  archive. Their own threads also appear in their list because staff
  participants are members.
- An owner or vendor needs a membership **and** a `clients` / `sub_vendors`
  audience, and the existing portal scope check (project + audience) still
  applies.
- If the project's `imported_conversations_staff_only` is on, outsiders are
  denied even with a membership, imported conversations drop out of their
  list, the importer adds no outside members, and adoption adds none. Turning
  the switch off restores access for the people who were in the threads.
- Legacy `bt-message-archive-*` channels keep their current staff-only rules
  until they are emptied and archived.

### Replies and notifications

Converted conversations use the normal send path, so replies, mentions,
notifications, unread counts and email replies behave exactly as in any
project conversation. Imported rows never notify:

- the importer writes no notification, email, outbox, mention, push or SMS
  rows and no unread counts (checked by `assertSilent` and by tests);
- `notifyChannelMessage` returns early for a message with a `source_system`
  (`shouldNotifyForMessage`), so no future code path can announce history.

## Capture

The capture side is designed here; the script is written only after
Buildertrend's real requests have been observed.

- Runs on a staff computer inside an administrator's normal, logged-in browser session on
  buildertrend.net. It is same-origin: no credential export, no password
  handling, no unofficial bulk export.
- Reads the same JSON the BT Messages pages already load, using only request
  paths and parameters first observed in normal page network traffic. No
  guessed endpoints.
- Walks job → message list → message detail (plus attachment metadata),
  writes the capture JSONL below, checkpoints by job and message id, and
  resumes after an interruption.
- Runs gently: rate-limited, backs off on 429 and 5xx, stops on any
  authentication error. It never writes to Buildertrend.
- Attachment bytes are hashed (sha256) as they are read; the bytes are kept
  in the capture's local staging folder for upload, never re-downloaded.

### Phases

0. **Observe.** An agent on that computer records sanitized request shapes (paths,
   parameters, response field names, no personal data) for one small project's
   Messages page. Not the legal-hold project.
1. **Write** the capture script against exactly those shapes.
2. **Pilot** on that one project; sample-compare captured messages with the
   screen (sender, recipients, date text, body, attachment names).
3. **Full run**, project by project, resuming from checkpoints.
4. **Import**: importer dry run → review list → approval → apply in batches
   with backups (below).

Token budget: agents start, monitor and sample-check runs. No agent reads
messages one by one.

### Capture JSONL contract (`bt-message-capture/v1`)

One JSON object per line. A `message` line per BT message, and a `thread`
line written after the last message of each thread (the importer only imports
threads whose `thread` line count matches the messages it holds).

```json
{"schema":"bt-message-capture/v1","type":"message",
 "btJobId":"5072748","btThreadId":"9100","btMessageId":"9101","btParentMessageId":null,
 "subject":"Kitchen tile","body":"Full message text, exactly as shown",
 "sentAtDisplay":"Oct 3, 2025 4:12 PM","sentAtZone":null,
 "sender":{"participantId":"111","namespace":"builder","role":"Project Manager","displayName":"Pat PM"},
 "recipients":[{"participantId":"222","namespace":"owner","role":"Owner","displayName":"Olive Owner","kind":"to"}],
 "attachments":[{"btAttachmentId":"77","fileName":"tile.jpg","mimeType":"image/jpeg","sizeBytes":183211,"sha256":"<64 hex>"}],
 "capturedAt":"2026-11-02T15:04:05Z","captureRunId":"run-1"}
{"schema":"bt-message-capture/v1","type":"thread","btJobId":"5072748","btThreadId":"9100","messageCount":1}
```

- `namespace` is BT's participant namespace (for example `builder`, `owner`,
  `sub`) so ids from different BT user tables never collide.
- `kind` on recipients is `to`, `cc` or `bcc`. A thread with any `bcc`
  recipient is held for review.
- `sentAtDisplay` is the literal text BT shows. `sentAtZone` is set only when
  BT shows a zone; otherwise the organization's time zone is assumed for the
  ordering instant and the literal text is kept in
  `messages.source_sent_at_snapshot`.
- `body` is the full text. Excerpts are not accepted.

## Importer (`scripts/import-buildertrend-messages.mjs`)

Dry run by default; it never connects to a database.

Inputs:

- `--capture` the JSONL above;
- `--participants` the reviewed participant map
  (`bt-participant-map/v1`): exact `namespace:participantId` keys with a
  decision `user` (a Compass account), `contact` (existing directory contact
  ids per project) or `new_contact` (add without inviting). Keys that are
  absent are unmatched;
- `--projects` `{ organizationId, actorUserId, timeZone, jobs: { btJobId: projectId } }`;
- `--files` optional `{ files: { sha256: { driveFileId } } }` for newly
  uploaded attachment bytes;
- `--out` the output folder; `--batch-size` threads per batch (default 40).

Flow:

1. Parse and validate every line (malformed input stops the run).
2. Group by thread; skip threads whose `thread` line is missing or whose
   count does not match (`pending.jsonl`, not an error).
3. Hold a whole thread for review when any message has an unmatched
   participant, a Bcc recipient, an unreadable date, an unverified attachment,
   an unmapped job, or the thread mixes owners and vendors (`review.jsonl`).
   A conversation is never shown with gaps or to the wrong audience.
4. For each importable thread write, in order: the conversation, new
   directory contacts, thread participant rows, memberships and read state
   (outsiders only when the project is not staff-only), then per message:
   - **convert**: `UPDATE` the legacy row `bt-message-<jobId>-<btMessageId>`
     in its archive channel into the new conversation (same id, exact body,
     source columns, original date). A legacy row that has staff thread
     replies is left in the archive unless the thread is staff-only, so
     internal notes are never exposed; it shows up in the verification query;
   - **or insert** a new row only when neither the legacy row nor a row with
     the same `source_message_id` exists;
   - message participant rows (sender / to / cc);
   - attachments, reusing the first stored file with the same sha256 (an
     earlier message attachment, then a daily-log photo with a verified
     hash, then the uploaded file from `--files`). An attachment with no
     stored file is skipped and listed in `attachments-unmapped.jsonl`; a
     re-run after upload adds it.
5. `retire-legacy.sql` (run last): deletes reviewed owner-history copies
   (`bt-owner-history-*`) whose message is now live in the owner's
   conversation and has no replies, and archives each legacy archive channel
   once it is empty.

Every statement is `ON CONFLICT DO NOTHING` or guarded by `NOT EXISTS`, so a
re-run never duplicates anything. Values are inlined literals (no bound
parameters) and every statement stays at or under 100 values. A
`checkpoint.json` records the batch files and which have been applied.
`--apply` only prints the wrangler command for each unapplied batch;
`--mark-applied <file>` records one as done.

### Idempotency keys

| Record | Key |
|--------|-----|
| conversation | `channels (organization_id, source_system, source_thread_id)`; id `bt-thread-<sha256(org, thread)[:32]>` |
| message | `messages (source_system, source_message_id)`; legacy rows keep their id |
| attachment | `message_attachments (message_id, source_attachment_id)`; id from (message, attachment) |
| participant | `project_source_record_participants (organization_id, project_id, source_record_type, source_record_id, source_participant_id)` |
| directory contact | id `bt-contact-<sha256(project, namespace:id)[:32]>` |
| membership / read state | unique `(channel_id, user_id)` |

## Review queue

`review.jsonl` lists held threads with a reason:
`participant_unmatched`, `bcc_recipient`, `sent_at_unreadable`,
`attachment_unverified`, `job_not_mapped`, `thread_spans_jobs`,
`mixed_owner_and_vendor`. Held messages stay where they are today (in the
staff archive, if they were already imported there). Resolving a reason
(adding the participant id to the map, mapping the job) and re-running the
importer imports the thread; nothing else changes.

## Backups

Before every apply session:

1. `bunx wrangler d1 time-travel info compass-db` and record the bookmark.
2. Export the touched tables for the projects in the batch (channels,
   messages, message_attachments, channel_members, channel_read_state,
   project_contacts, project_source_record_participants) with read-only
   `SELECT`s to a restricted backup folder.
3. Keep the capture JSONL, maps and generated SQL with the run.

Rollback is a D1 time-travel restore to the bookmark (the batches only add
rows, move legacy archive rows and delete reviewed duplicate copies).

## Rollout

1. Merge this PR; apply migration 0287 to production from the PR's
   main-based worktree after checking the pending list. Additive only.
2. Run the read-only `docs/plans/bt-messages-archive-shape-check.sql`
   against production and confirm the archive shape the importer assumes
   (archive channel ids, legacy message ids, owner-history copies, rows with
   staff replies). Stop if any "must be 0" check is not 0.
3. Turn on **Imported conversations staff only** for the legal-hold project
   on its Information page.
4. Build the participant map: a read-only query of
   `buildertrend_staging_access_candidates` and existing `project_contacts`
   with `source_system = 'buildertrend'` gives exact ids that already map;
   everything else is decided by a person (`user`, `contact` or
   `new_contact`).
5. Capture phases 0–3 (above).
6. Importer dry run; review `summary.json`, `review.jsonl`,
   `attachments-unmapped.jsonl`; upload unmapped attachment bytes and add
   them to `--files`.
7. Backup, then apply batches one at a time (`--apply` prints the commands),
   then `retire-legacy.sql`. Spot-check each project after its batch.

## Verification queries (read only)

```sql
-- One live message per BT message; no BT message left in two places.
SELECT source_message_id, COUNT(*) FROM messages
WHERE source_system = 'buildertrend' GROUP BY 1 HAVING COUNT(*) > 1;

-- Legacy rows still in archives (held for review or with staff replies).
SELECT channel_id, COUNT(*) FROM messages
WHERE channel_id LIKE 'bt-message-archive-%' GROUP BY 1;

-- Owner-history copies whose message is now live (should be zero after retire-legacy.sql).
SELECT h.id FROM messages h
JOIN messages m ON m.source_system = 'buildertrend'
 AND h.id LIKE 'bt-owner-history-%-' || m.source_message_id
WHERE h.id LIKE 'bt-owner-history-%';

-- Outsiders in imported conversations on a staff-only project (must be zero).
SELECT c.id, cm.user_id FROM channels c
JOIN projects p ON p.id = c.project_id AND p.imported_conversations_staff_only = 1
JOIN channel_members cm ON cm.channel_id = c.id
JOIN organization_members om ON om.user_id = cm.user_id AND om.organization_id = c.organization_id
WHERE c.source_system IS NOT NULL
  AND om.role IN ('owner','client','supplier','subcontractor','guest');

-- Nothing imported is unread and nothing notified.
SELECT COUNT(*) FROM channel_read_state r JOIN channels c ON c.id = r.channel_id
WHERE c.source_system IS NOT NULL AND r.unread_count > 0 AND r.last_read_message_id IS NULL;
SELECT COUNT(*) FROM notification_events e JOIN messages m ON m.id = e.source_id
WHERE e.source_type = 'message' AND m.source_system IS NOT NULL;

-- Attachments stored twice with the same bytes (must be zero distinct storage per hash).
SELECT content_sha256, COUNT(DISTINCT r2_path) FROM message_attachments
WHERE content_sha256 IS NOT NULL GROUP BY 1 HAVING COUNT(DISTINCT r2_path) > 1;
```

## Open items

- Threads that mix owners and vendors are held. If they turn out to be
  common, a follow-up can split them per audience (owner part and vendor
  part) with the owner's approval.
- Legacy archive rows with staff thread replies are not exposed. Staff decide
  per thread whether to move the replies too (a separate, reviewed step).
