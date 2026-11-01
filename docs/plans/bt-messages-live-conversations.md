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
only by the exact rules in "Participant matching" below (never fuzzy,
initials, nicknames or order), and anyone unmatched or ambiguous goes to a
review list; attachments are deduplicated by sha256 and byte size (BT
client-update photos are often the same bytes as daily-log photos); the
import is idempotent by BT message id.

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
| owners **and** vendors | `staff` (kept internal) | all internal staff |

Owner decision (2026-11-01): a thread with both owners and vendors is kept
internal. It imports as a staff-only conversation on the project, still with
the `[BT]` tag; staff can read and reply internally; no outside person is a
member, and accepting an invitation never adds anyone to it (adoption only
joins `clients` / `sub_vendors` conversations). The owner-history copies the
owner can already see in their Owner Team channel are left in place for these
threads. `summary.json` counts them as `mixed_kept_internal`.

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

## Legacy archives in production (shape check, 2026-11-01)

The read-only `docs/plans/bt-messages-archive-shape-check.sql` was run
against production before any apply. It found:

- **11 numeric archives** `bt-message-archive-<digits>` holding 4,069
  messages: 4,068 legacy rows `bt-message-<jobId>-<btMessageId>` (all top
  level, no staff replies, no duplicates) and **one non-legacy top-level row**.
- **82 `bt-message-archive-estimate-<id>` channels**, about one message each,
  all created in one batch on 2026-08-29. Nothing in this repository creates
  them; from the name and timing they are a one-time import of Buildertrend
  estimate/lead-stage notes rather than BT message threads.
- **219 owner-history copies**, all in owner channels, each with its source
  row present and no replies.
- **21 archives are private** (`is_private = 1`); all are `audience = 'staff'`.

What the importer does with each:

- **Only numeric archives are converted.** Capture ids must be numeric
  (`btJobId`, `btMessageId`), so the importer can only ever address
  `bt-message-archive-<digits>` channels and `bt-message-<digits>-<digits>`
  rows. The estimate channels are never read, moved or archived.
  Recommendation (no action now): leave them staff-only as they are; once the
  lead/estimate capture is reviewed, either import them through the same
  importer as their own source or move their notes to the project's notes,
  then archive the channels.
- **Non-legacy rows stay put.** Conversion only updates the exact legacy row
  id, so the one other row in a numeric archive stays in that staff-only
  archive, which is then not retired (it is not empty). Shape-check A4 lists
  it by id prefix for staff to look at.
- **Private archives stay private.** The access code treats a private archive
  as closed even to staff (`canAccessConversationChannel` requires a
  non-private archive), so private is a deliberate lock, not a default. Every
  thread of a job whose archive is private goes to review
  (`private_archive`, from the pre-check), and every statement for a thread
  also carries a SQL guard that does nothing if the job's archive is private,
  so a stale pre-check cannot expose one.

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

When Buildertrend exposes no thread id for a message, the capture leaves
`btThreadId` out (or `null`). The importer then derives the thread id
`msg-<btMessageId>`: each such message is its own one-message conversation and
needs no `thread` line. Real BT thread ids are stored unprefixed and may not
start with `msg-`, so the two can never collide. The capture never writes the
prefix itself.

```json
{"schema":"bt-message-capture/v1","type":"message",
 "btJobId":"1234567","btThreadId":"9100","btMessageId":"9101","btParentMessageId":null,
 "subject":"Kitchen tile","body":"Full message text, exactly as shown",
 "sentAtDisplay":"Oct 3, 2025 4:12 PM","sentAtZone":null,
 "sender":{"participantId":"111","namespace":"builder","role":"Project Manager","displayName":"Pat PM"},
 "recipients":[{"participantId":"222","namespace":"owner","role":"Owner","displayName":"Olive Owner","kind":"to"}],
 "attachments":[{"btAttachmentId":"77","fileName":"tile.jpg","mimeType":"image/jpeg","sizeBytes":183211,"sha256":"<64 hex>"}],
 "capturedAt":"2026-11-02T15:04:05Z","captureRunId":"run-1"}
{"schema":"bt-message-capture/v1","type":"thread","btJobId":"1234567","btThreadId":"9100","messageCount":1}
```

- `namespace` is BT's participant namespace (for example `builder`, `owner`,
  `sub`) so ids from different BT user tables never collide; `unknown` when
  the page does not say.
- `participantId` is `null` when the page does not show it (message pages
  usually show only names). Add `email` on the sender or a recipient whenever
  the page shows one. Each participant needs at least an id, an email or a
  display name.
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
- `--participants` optional reviewed participant map
  (`bt-participant-map/v1`): exact `namespace:participantId` keys with a
  decision `user` (a Compass account), `contact` (existing directory contact
  ids per project) or `new_contact` (add without inviting);
- `--directory` optional directory snapshot (`bt-directory-snapshot/v1`),
  exported read-only just before the run by
  `scripts/export-bt-directory-snapshot.mjs` (its header lists the BT id
  registry it uses): one row per Compass person
  `{ personKey, kind: staff|owner|vendor, displayName, emails[], userId?,
  projectIds[], projectContactIds{projectId: id}, vendorId?, vendorContactId?,
  customerId?, customerContactId?, btIds["<catalog type>:<btId>"] }`, with a
  user and the contacts that are the same person grouped into one row;
- `--people-catalog` optional BT people catalog captured from Buildertrend
  (JSONL rows `{ btId, type: internal_user|vendor_company|vendor_contact|customer,
  parentBtId, displayName, email? }`);
- `--projects` `{ organizationId, actorUserId, timeZone, jobs: { btJobId: projectId }, staffOnlyProjects: [projectId] }`;
  `staffOnlyProjects` lists the projects that must be staff-only (legal hold);
- `--precheck` required `{ schema: "bt-import-precheck/v1", staffOnlyProjectIds, privateArchiveJobIds }`,
  filled from shape-check B1 (after 0287) and A8 just before the run;
- `--files` optional `{ files: { sha256: { driveFileId } } }` for newly
  uploaded attachment bytes;
- `--out` the output folder; `--batch-size` threads per batch (default 40).

Flow:

1. Parse and validate every line (malformed input stops the run).
2. Group by thread; skip threads whose `thread` line is missing or whose
   count does not match (`pending.jsonl`, not an error).
3. Hold a whole thread for review when its job's archive is private, when its
   project must be staff-only but the pre-check does not show the switch on
   (`staff_only_not_verified`), or when any message has an unmatched
   or ambiguous participant, a Bcc recipient, an unreadable date, an unverified attachment,
   or an unmapped job (`review.jsonl`). A thread with both owners and vendors is kept internal.
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
   - attachments, reusing a stored file only when both the sha256 **and** the
     byte size match, within the same scope: an earlier message attachment in
     the same organization and conversation audience, then a daily-log photo
     with a verified hash in the same organization, then the uploaded file
     from `--files`. An attachment with no
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

## Participant matching

Buildertrend message pages show participant names (sometimes emails) but not
BT participant ids. Owner decision (2026-11-01); the importer
(`scripts/import-buildertrend-participants.mjs`) applies these in order and
stops at the first that decides:

0. **Reviewed map.** When the capture saw a BT participant id and the
   reviewed map has that exact `namespace:participantId`, it wins.
1. **Email** (`by_email`). The email shown, trimmed and case-insensitive,
   matching exactly one person in the organization's directory snapshot
   (users, vendor contacts, customer contacts, project contacts). More than
   one person with that email: review (`participant_ambiguous`).
2. **Name in the project** (`by_name_project`). The exact full display name,
   case-insensitive with whitespace normalized (no fuzzy matching, initials
   or nicknames), matching exactly one of the project's own people (its
   staff and project contacts). Two or more: review.
3. **Name in the BT catalog** (`by_name_catalog`). Otherwise the same exact
   name matching exactly one row of the BT people catalog. That row must then
   resolve to exactly one Compass person by its exact BT id registered in the
   directory (`<type>:<btId>`), else by the catalog row's email. Anything
   else: review.
4. Otherwise the participant is unmatched (`participant_unmatched`) or
   ambiguous (`participant_ambiguous`) and the whole thread goes to review.

A matched person without a Compass account is added to the project as a
directory contact without an invitation (linked to their vendor or customer
contact when the snapshot has one), once per person however the pages named
them. `summary.json` reports `participant_matches` per thread participant:
`by_map`, `by_email`, `by_name_project`, `by_name_catalog`, `review`.

## Review queue

`review.jsonl` lists held threads with a reason:
`participant_unmatched`, `participant_ambiguous`, `bcc_recipient`, `sent_at_unreadable`,
`attachment_unverified`, `job_not_mapped`, `thread_spans_jobs`,
`private_archive`, `staff_only_not_verified`. (Threads with both owners and
vendors are not held; they are kept internal.) Held messages stay where they are today (in the
staff archive, if they were already imported there). Resolving a reason
(adding the person to the reviewed map or the directory, mapping the job) and re-running the
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
3. **Before any batch is applied**, turn on **Imported conversations staff
   only** for the legal-hold project (its Buildertrend job is named in the rollout ticket),
   re-run shape-check B1/B2 and confirm it is listed. List the project in
   `staffOnlyProjects` in the projects map: the importer then refuses that
   project's threads unless the pre-check shows the switch on, emits no
   outside memberships for it, and every statement for it requires the
   switch to still be on in the database.
   Turn on **Imported conversations staff only** for any other held project
   on its Information page.
4. Export the directory snapshot (read only) with
   `node scripts/export-bt-directory-snapshot.mjs --org <organizationId>`
   (prints its SELECTs) and then `--run --out directory.json` (runs them with
   `wrangler d1 execute --remote --json --command`; organization-scoped,
   paged, no bound parameters, no message content). Capture the BT people
   catalog. Optionally build a reviewed participant map for people whose BT
   ids were seen (`user`, `contact` or `new_contact`).
5. Capture phases 0–3 (above).
6. Build `precheck.json` from shape-check A8 and B1 just before the run, then
   the importer dry run; review `summary.json` (including `mixed_kept_internal`), `review.jsonl`,
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

- The 82 estimate archives and the one non-legacy row in a numeric archive
  stay as they are (see "Legacy archives in production").
- Legacy archive rows with staff thread replies are not exposed. Staff decide
  per thread whether to move the replies too (a separate, reviewed step).
