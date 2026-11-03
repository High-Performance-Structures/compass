# Data Model Consolidation Plan

Status: proposal. Docs only; no schema or code changes ship with this plan.
Baseline: `main` at the time of writing (latest migration `0278`).

The [architecture standard](architecture-standards.md) says "one concept, one
table" and "lists of records are rows, not JSON". Five areas still break that
rule. This plan inventories each one, says which "duplicates" are real and
which are different concepts that must stay apart, and gives an additive
migration path for the real ones.

Paths are `file:line` of the Drizzle table definition. "Owner" is the domain
module whose `store.ts` is the only allowed writer. Where a table is written
outside its owner today, the writer is listed as a standard violation to fix as
part of the migration.

## Common migration recipe

D1 cannot rebuild tables, and dropping a parent wipes or orphans children, so
every consolidation is additive and runs the same six steps. Old tables stay in
place at the end.

1. **Create** the new table (or a SQL view when the goal is only a combined
   read). One migration, additive only, with foreign keys, indexes, unique link
   pairs and `enum:` lists per the standard.
2. **Dual-write.** The owning domain store writes the new row in the same
   `db.batch` as the old row, so the two cannot diverge. Callers do not change.
   Use `chunkD1InsertRows` / `chunkD1Values` (`src/lib/d1-query.ts`) for bulk
   work.
3. **Backfill script** in `scripts/` (`.mjs`, plain SQL out). Default is
   dry-run: it prints counts, rows it would insert, and rows it cannot map.
   `--apply` is explicit. It is idempotent (insert-or-ignore on the new unique
   key), works in bounded batches per organization, and never issues one huge
   `UNION` read. A dry-run diff of old vs new row counts is attached to the PR.
4. **Switch reads** behind a company-neutral flag in feature settings, one
   reader at a time, comparing old and new results in tests before the flip.
5. **Freeze the old writers.** Remove the old write path, and lock it with the
   architecture-baseline ratchet (`bun scripts/architecture-baseline.mjs
   --write` only ever lowers counts). The old table becomes read-only.
6. **Archive.** Mark the old table `// deprecated: read-only since <PR>` in the
   schema. Leave it, its data and its migration in place. Dropping is a
   separate, later decision.

Rollback at any step before 5 is "flip the read flag back". After 5, the old
table still holds a complete copy up to the freeze date.

## 1. Calendars

### Current tables

| Table | Schema | Owner / writers | Readers |
|-------|--------|-----------------|---------|
| `organization_calendar_settings` | `schema.ts:1974` | `domain/work-calendar/store.ts` | `my-compass-calendar/sync.ts`, `project-calendars/sync.ts`, `morning-plan/server.ts`, `weather/schedule-risk-server.ts`, `daily-logs/log-followups-server.ts` |
| `work_calendar_events` | `schema.ts:1993` | `domain/work-calendar/store.ts` | `domain/work-calendar/loaders.ts`, `google/calendar/sync.ts`, `project-calendars/sync.ts`, `morning-plan/server.ts`, `daily-logs/reminders-server.ts`, `jarvis/calendar-search.ts` |
| `work_calendar_event_attendees` | `schema.ts:2245` | `domain/work-calendar/store.ts` | same loaders and sync |
| `project_client_meetings` | `schema.ts:2052` | `domain/media/store.ts` | `actions/project-client-meetings.ts`, `client-meetings/*`, `morning-plan/server.ts`, `project-calendars/sync.ts` |
| `google_calendar_connections` | `schema.ts:2268` | `domain/calendars/store.ts` | `actions/google-calendar.ts`, `api/google/calendar/callback/route.ts`, `google/calendar/sync.ts` |
| `google_calendar_selections` | `schema.ts:2321` | `domain/calendars/store.ts` | `actions/google-calendar.ts`, `google/calendar/sync.ts` |
| `google_calendar_events` (inbound mirror) | `schema.ts:2485` | `google/calendar/sync.ts` (not a domain store) | `domain/work-calendar/loaders.ts`, `jarvis/calendar-search.ts` |
| `google_calendar_entity_links` (outbound map) | `schema.ts:2534` | `google/calendar/sync.ts` | `domain/work-calendar/loaders.ts` |
| `google_project_calendars` | `schema.ts:2389` | no writer in `src/` | `actions/google-calendar.ts`, `api/google/calendar/callback/route.ts`, `google/calendar/project-routing.ts` |
| `google_project_calendar_acl_members` | `schema.ts:2435` | none | none |
| `google_project_calendar_subscriptions` | `schema.ts:2460` | none | none |
| `my_compass_calendars` (per person) | `schema.ts:2106` | `domain/calendars/store.ts` | `actions/my-compass-calendar.ts`, `actions/morning-plan.ts`, `my-compass-calendar/sync.ts` |
| `my_compass_calendar_items` | `schema.ts:2153` | `my-compass-calendar/sync.ts` (violation) | same |
| `compass_project_calendars` | `schema.ts:2176` | `domain/calendars/store.ts` | `actions/project-calendars.ts`, `project-calendars/sync.ts` |
| `compass_project_calendar_events` | `schema.ts:2202` | `project-calendars/sync.ts` (violation) | same |
| `compass_project_calendar_members` | `schema.ts:2222` | `project-calendars/sync.ts` (violation) | `actions/project-calendars.ts` |
| `projects.google_calendar_id` (column) | `schema.ts:834` | `actions/project-registry.ts`, `actions/google-calendar.ts`, `actions/project-duplicates.ts`, `domain/calendars/store.ts` | `project-calendars/sync.ts`, `my-compass-calendar/sync.ts` |

The header of `domain/calendars/store.ts` already admits it: "Project
calendars are still stored three ways (`projects.google_calendar_id`,
`compass_project_calendars` and `google_project_calendars`)."

### How they overlap and differ

There are really four different things under the word "calendar":

1. **Compass-native events** (`work_calendar_events` + attendees,
   `project_client_meetings`). Records people create in Compass. Different
   concept: they own meaning (type, visibility, recurrence, version,
   transcript). Keep.
2. **Credentials and sources** (`google_calendar_connections`, `_selections`).
   They hold encrypted tokens and per-user sync choices. Keep; never merge
   credentials into a general table.
3. **Inbound mirror** (`google_calendar_events`): a cache of someone else's
   events, keyed by `(selection_id, google_event_id)`. Compass does not own
   them. Keep.
4. **Outbound managed calendars** (`my_compass_calendars`,
   `compass_project_calendars`, `google_project_calendars`,
   `projects.google_calendar_id`, plus the two item/event mapping tables and the
   member table). This is the real duplication.

Evidence for item 4:

- `my_compass_calendar_items` (`user_id, item_key, google_event_id,
  content_hash`, unique `(user_id, item_key)`) and
  `compass_project_calendar_events` (`project_id, item_key, google_event_id,
  content_hash`, unique `(project_id, item_key)`) are the same table with a
  different owner column. Both use the `"<source>:<record id>"` key.
- `my_compass_calendars` and `compass_project_calendars` share
  `google_calendar_id`, `status` (`pending | active | error`, personal adds
  `removed`), `last_synced_at`, `last_error`, `enabled`, timestamps. Only the
  owner key (user vs project) differs, plus `other_names` (person) and
  `owner_email` / `calendar_name` (project).
- `google_calendar_entity_links` (`schema.ts:2534`) is a third outbound
  mapping keyed `(connection_id, google_calendar_id, source_type, source_id)`.
  Same job (Compass record to Google event) for user-OAuth connections instead
  of the service-owned calendars.
- `google_project_calendars` has an owner connection, selection and ACL/
  subscription children, but no writer in `src/`, and the two child tables have
  no readers at all. They look like a superseded design. Confirm production
  row counts before archiving.
- Attendees exist twice: `work_calendar_event_attendees` is a proper child
  table, while `project_client_meetings` stores `guest_emails` / `staff_emails`
  as JSON text (see section 5).

### Target model

Keep native events, connections/selections and the inbound mirror as they are.
Replace the outbound managed-calendar family with three tables:

- `calendar_targets`: `id`, `organization_id`, `kind` (`user | project`, from an
  exported `CALENDAR_TARGET_KINDS` const), `user_id` (nullable, FK),
  `project_id` (nullable, FK), `google_calendar_id`, `owner_email`,
  `calendar_name`, `enabled`, `status` (one shared list), `last_synced_at`,
  `last_error`, timestamps. Partial unique indexes on `user_id` and on
  `project_id`; a check constraint requires exactly one owner column.
- `calendar_target_items`: `id`, `target_id` FK, `item_key`,
  `google_event_id`, `content_hash`, timestamps. Unique `(target_id,
  item_key)`. Replaces both mapping tables.
- `calendar_target_members`: `target_id`, `user_id`, `email`, `acl_rule_id`,
  `listed_at`. Unique `(target_id, user_id)`. Only project targets use it
  today.

Person-only fields (`other_names`) move to a child table
`calendar_target_aliases(target_id, name)` (also fixes a JSON list, section 5).
`projects.google_calendar_id` becomes a read-through of `calendar_targets` and
is frozen, not dropped. `google_calendar_entity_links` stays for now; folding it
into `calendar_target_items` is a phase-two option once the user-OAuth push path
is the only remaining consumer.

Single owner: extend `domain/calendars/store.ts` to write all three tables and
move the item and member writes out of `my-compass-calendar/sync.ts` and
`project-calendars/sync.ts` (clearing existing ratchet violations).

### Migration path

1. Migration: create `calendar_targets`, `calendar_target_items`,
   `calendar_target_members`, `calendar_target_aliases`.
2. Dual-write in `domain/calendars/store.ts`: every upsert of
   `my_compass_calendars` / `compass_project_calendars`, and every item and
   member write in the two sync modules, goes through store functions that
   write old and new rows in one batch.
3. Backfill `scripts/backfill-calendar-targets.mjs`: dry-run prints counts per
   kind and any `projects.google_calendar_id` that disagrees with
   `compass_project_calendars.google_calendar_id`; `--apply` inserts targets,
   then items, then members, then aliases (parse `other_names`).
4. Switch reads: `my-compass-calendar/sync.ts`, `project-calendars/sync.ts`,
   `actions/my-compass-calendar.ts`, `actions/project-calendars.ts`,
   `actions/morning-plan.ts`. Verify with a sync dry run that produces zero
   Google writes (hashes match).
5. Freeze old writers; ratchet the baseline down.
6. Archive the six old tables and mark `google_project_calendars` and its two
   children deprecated.

Risk: medium. The sync jobs talk to Google, and a hash mismatch causes a mass
rewrite of events (visible to users, rate-limited by Google). Mitigation:
backfill copies `content_hash` verbatim and the read switch is verified by a
no-op sync. Effort: 28-36 h (schema and store 6, sync rewrites 10-12, backfill
4, tests 6-8, rollout 2-4).

## 2. Email and correspondence threads

### Current tables

| Table | Schema | Owner / writers | Readers |
|-------|--------|-----------------|---------|
| `email_reply_threads` | `schema.ts:495` | `domain/correspondence/email-store.ts` | `actions/project-email.ts`, `notifications/events.ts`, `email/gmail-inbound.ts` |
| `inbound_emails` | `schema.ts:531` | `domain/correspondence/email-store.ts` | `email/gmail-inbound.ts`, `actions/inbound-email-review.ts`, `actions/record-email-replies.ts`, `actions/project-rfis.ts`, `domain/correspondence/queries.ts` |
| `correspondence_email_threads` | `schema-correspondence-email.ts:6` | `email-store.ts` | `correspondence/email-adapter.ts` |
| `correspondence_email_deliveries` | `schema-correspondence-email.ts:38` | `email-store.ts` | `correspondence/email-adapter.ts` |
| `correspondence_email_events` | `schema-correspondence-email.ts:80` | `email-store.ts` | `correspondence/email-adapter.ts` |
| `project_correspondence`, `_messages`, `_recipients`, `_participants`, `_user_state`, `_drafts`, `_attachments`, `_revisions`, `_outbox`, `_write_guards`, `_composition_drafts`, `_saved_drafts` | `schema-correspondence.ts:4-131` | `domain/correspondence/store.ts` | `correspondence/read.ts`, `correspondence/send.ts`, `actions/project-correspondence.ts` |
| `correspondence_source_messages` / `_recipients` (imported evidence) | `schema-correspondence-source.ts:7` | none in `src/` | `correspondence/read.ts`, `actions/project-correspondence.ts` |
| `project_email_campaigns`, `project_email_recipients` | `schema-project-email.ts:7`, `:31` | `actions/project-email.ts` (violation) | `email/project-email-replies.ts`, `email/project-email-privacy.ts`, `correspondence/read.ts`, `correspondence/send.ts` |
| `project_rfq_email_deliveries` | `schema-rfqs.ts:7` | `domain/operations/store.ts` | `actions/project-rfq-email.ts`, `actions/project-operations.ts`, `notifications/events.ts` |
| `notification_events` / `notification_deliveries` | `schema.ts:413`, `:468` | `domain/notifications/store.ts` | `domain/notifications/queries.ts` |
| `project_access_invitations` (email status columns) | `schema.ts:3363` | project access modules | invitation flows |
| `email_mailbox_state` | `schema.ts:3417` | `email/mailbox-state.ts` | same |
| `staff_message_records`, `staff_message_events`, `goto_inbound_events` | `schema.ts:1298`, `:1359`, `:1390` | `domain/feedback/inbound-store.ts` | `actions/staff-message-desk.ts`, `goto/inbound.ts` |
| `messages` (chat) | `schema-conversations.ts:45` | `domain/conversations/store.ts` | chat actions |

### How they overlap and differ

Real overlap, all in the "outside email on a record" path:

- **Two reply-thread tables.** `email_reply_threads` (token, reply address,
  `source_type + source_id`, subject, status, `last_inbound_at`) is what
  `sendTrackedEmail` uses for every record kind. `correspondence_email_threads`
  (reply token, reply address, `conversation_id`, `anchor_message_id`) is the
  same idea for project correspondence. Both have a unique reply token, a reply
  address and a project, and both are matched from the same Gmail inbound path.
  The only structural difference is what the thread points at: a generic source
  record vs a `project_correspondence` conversation.
- **Delivery ledgers in four places.** `correspondence_email_deliveries`
  (per message per recipient, status, provider message id, attempts, error),
  `project_rfq_email_deliveries`, `project_email_recipients` and
  `notification_deliveries` (email channel) each track "did the provider accept
  this address". Same columns, different parent.
- **Inbound ledgers in two places.** `inbound_emails` (Gmail message id,
  matched status, posted message) and `correspondence_email_events` (provider
  event id, status, hold reason) both record "an inbound message arrived and was
  matched, held or posted".
- `project_email_campaigns` / `_recipients` is the older project email feature.
  The email workflow standard (`docs/development/email-workflows.md`) routes
  new sends through `sendTrackedEmail`, so this pair is legacy. It is also the
  one email store still written from an action file.

Different concepts that stay separate:

- `project_correspondence*` (the in-app conversation, drafts, revisions,
  outbox, write guards). This is the message record, not the transport.
- `correspondence_source_*`: imported, read-only evidence.
- `messages` and channels (team chat) and `staff_message_*` /
  `goto_inbound_events` (phone and SMS desk). Different channel, audience and
  lifecycle.
- `notification_events` (an in-app/push/SMS fan-out). Email is one channel
  there; only the email delivery rows overlap.
- `email_mailbox_state`: a shared rate-limit lease, not a thread.

### Target model

One transport layer, three tables, with the correspondence conversation as an
optional target:

- `email_threads`: today's `email_reply_threads` plus a nullable
  `conversation_id` (FK to `project_correspondence`) and nullable
  `anchor_message_id`. `source_type` gains the value `correspondence`. Unique on
  token, on `conversation_id` where not null, and on `anchor_message_id` where
  not null.
- `email_deliveries`: `id, organization_id, project_id, thread_id FK,
  source_type, source_id, recipient_user_id (nullable), recipient_email,
  provider, status (one shared list), provider_message_id, attempt_count,
  queued_at, accepted_at, failed_at, error`. Unique `(source_type, source_id,
  recipient_email, provider)`. Absorbs the four delivery ledgers.
- `inbound_emails`: keep, add `provider`, `provider_event_id`, `hold_reason`;
  unique `(provider, provider_event_id)`. Absorbs `correspondence_email_events`.

Because `email_reply_threads` and `inbound_emails` already exist and are the
busiest, build the target by extending them (additive `ADD COLUMN`
migrations) rather than creating differently named tables. Only
`email_deliveries` is new. The correspondence adapter then writes into the
shared tables and `correspondence_email_threads` / `_events` freeze.

Single owner: `domain/correspondence/email-store.ts` (already owns five of the
tables). Move the `project_email_*` and RFQ delivery writes behind it.

### Migration path

1. Migration: add nullable columns to `email_reply_threads` and
   `inbound_emails`; create `email_deliveries` (FK indexes, unique key).
2. Dual-write in `email-store.ts`: `insertEmailThreadIfMissing`,
   `insertEmailDelivery`, `insertEmailEventOnce` write both shapes. RFQ and
   campaign delivery writes call the same store function.
3. Backfill `scripts/backfill-email-transport.mjs` (dry-run default): copy
   `correspondence_email_threads` into `email_reply_threads` (reply token and
   address are already unique; report collisions), deliveries from the three
   ledgers, events into `inbound_emails`. Report rows whose parent is gone.
4. Switch reads: `email-adapter.ts` first (smallest), then `gmail-inbound.ts`
   matching (token lookup must check the new column set), then RFQ and campaign
   readers.
5. Freeze old writers; delete the action-level writes in
   `actions/project-email.ts` once the campaign UI reads the shared tables.
6. Archive `correspondence_email_*`, `project_email_*`,
   `project_rfq_email_deliveries`.

Risk: high. Inbound reply matching is live, and a wrong token lookup drops a
reply. Mitigation: dual-read in the inbound path (look up new, fall back to old)
for one release and log mismatches. Effort: 36-48 h (schema 4, store and
adapters 12-14, inbound matching 8, backfill 5, tests 8-10, rollout 3-4).

## 3. Saved views

### Current tables

| Table | Schema | Owner / writers | Readers |
|-------|--------|-----------------|---------|
| `project_saved_views` | `schema.ts:1636` | `domain/settings/store.ts` | `actions/project-views.ts` |
| `schedule_saved_views` | `schema.ts:1654` | `domain/schedule/store.ts` | `actions/schedule-saved-views.ts` |
| `user_view_preferences` | `schema.ts:1580` | `domain/settings/store.ts` | `actions/view-preferences.ts`, `actions/project-views.ts` |
| `custom_dashboards` | `schema-dashboards.ts:4` | dashboard actions | dashboard pages |
| `organization_feature_settings` | `schema.ts:1595` | `domain/settings` | settings readers |

### How they overlap and differ

`project_saved_views` and `schedule_saved_views` are the same table: `id,
organization_id, owner_user_id, name, visibility (personal | shared),
definition (JSON text), created_at, updated_at`. The differences are
accidental. The project table types `visibility` as an enum and makes the name
unique per `(owner, organization, name)`; the schedule table leaves
`visibility` as free text and makes the name unique per `(owner, name)`, not
scoped to organization, which is a latent bug for a person in two
organizations. The definition payloads are validated by different zod schemas
(`projectViewDefinitionSchema` in `src/lib/project-views.ts`,
`scheduleViewDefinitionSchema` in `actions/schedule-saved-views.ts`). That
validation is the legitimate per-scope part.

`user_view_preferences` is a key-value store. Its per-organization project
default key holds the user's default project view (read and written in
`actions/project-views.ts`), while the same table also holds `role-dashboard:*`
list ordering. The default view points at or copies a saved view, so it belongs
with saved views; list ordering is a UI preference and stays.

Stay separate: `custom_dashboards` (AI-generated render specs and queries, a
different artifact), `organization_feature_settings` (company-level settings,
not per-user views), and browser-local state such as
`components/project-list-provider.tsx` (per device by design).

### Target model

- `saved_views`: `id, organization_id, owner_user_id, scope` (exported
  `SAVED_VIEW_SCOPES` const: `projects | schedule`), `name, visibility`
  (`personal | shared`), `definition` (JSON, with a `// json: filter definition
  validated per scope` comment), timestamps. Unique `(organization_id,
  owner_user_id, scope, name)`; index `(organization_id, scope, visibility)`.
- `saved_view_defaults`: `user_id, organization_id, scope, view_id` (nullable FK
  to `saved_views`), `inline_definition` (nullable; holds a default that is not
  a named view). Primary key `(user_id, organization_id, scope)`.
- `user_view_preferences` stays for ordering and similar UI state only.

One owner: `domain/settings/store.ts` for `saved_views` and defaults;
`domain/schedule/store.ts` stops writing views and calls it. Per-scope
validation stays in the callers.

### Migration path

1. Migration: create `saved_views`, `saved_view_defaults`.
2. Dual-write in both stores (create, rename, delete, visibility change), plus
   default set and clear in `actions/project-views.ts`.
3. Backfill `scripts/backfill-saved-views.mjs` (dry-run default): copy both
   tables keeping ids (so stored references stay valid), report name
   collisions caused by the wider unique key, and convert project default
   preference rows into `saved_view_defaults`.
4. Switch reads in the two actions and in `dashboard/projects/page.tsx` and
   `dashboard/schedule/page.tsx`.
5. Freeze the old writers and the project-default preference key.
6. Archive `project_saved_views`, `schedule_saved_views`; leave the preference
   rows.

Risk: low. Small tables, no integrations, user-scoped reads. Effort: 8-10 h
(schema 1, stores and actions 3, backfill 2, tests 2-3, rollout 1). A third
view scope later becomes a constant plus a zod schema, not a table.

## 4. Event, activity and audit logs

### Current tables

About 30 tables record "something happened". Grouped by purpose:

**A. User-facing activity feed**

| Table | Schema | Writer | Readers |
|-------|--------|--------|---------|
| `activity_events` | `schema.ts:1256` | `lib/activity-log.ts` `recordActivityEvent` (about 94 call-site files) | `actions/activity.ts`, `project-timeline/server.ts`, `actions/vendor-trade-doc-requests.ts` |

**B. Machine audit: who changed what**

| Table | Schema | Writer |
|-------|--------|--------|
| `project_profile_audit_events` (before/after) | `schema.ts:1176` | `domain/project-audit/store.ts` `recordProjectAudit` (about 22 files) |
| `permission_audit_events` | `schema.ts:717` | `actions/permission-overrides.ts` (violation) |
| `contact_merge_events` | `schema.ts:3833` | raw SQL in `domain/contacts/store.ts:766` |
| `contact_account_link_events` | `schema.ts:3911` | raw SQL in `domain/contacts/store.ts:793` |
| `sage_contact_link_events` / `_change_events` / `_create_events` | `schema-sage.ts:157`, `:226`, `:279` | `domain/sage-bridge/contact-store.ts` |
| `plugin_events` | `schema-plugins.ts:45` | `actions/plugins.ts` (violation) |

Nothing in `src/` reads group B back, so these are write-only trails today.

**C. Per-record history that drives product behavior**

| Table | Schema | Writer |
|-------|--------|--------|
| `project_todo_events` | `schema.ts:3533` | `domain/operations/store.ts`; read by `project-timeline/server.ts`, `daily-logs/log-followups-server.ts` |
| `project_warranty_claim_events` | `schema-warranty.ts:119` | `domain/warranty/store.ts` |
| `project_rfq_manual_response_events` | `schema-rfqs.ts:31` | `domain/operations/store.ts` |
| `project_selection_decision_events` | `schema-selection-decisions.ts:73` | selection decision store |
| `project_change_order_history` | `schema.ts:3054` | `domain/estimates/store.ts` |
| `project_contract_budget_revisions` | `schema-estimates.ts:581` | `domain/financials/store.ts` |
| `rate_book_entry_history` | `schema-rate-book.ts:49` | `actions/rate-book.ts` (violation) |
| `correspondence_revisions` | `schema-correspondence.ts:90` | `domain/correspondence/store.ts` |
| `equipment_log_entries` | `schema-equipment.ts:74` | `actions/equipment.ts` (violation) |

**D. Integration and inbound ledgers (idempotency, retries)**

`jarvis_bridge_events` (`schema-jarvis.ts:134`), `goto_inbound_events`
(`schema.ts:1390`), `staff_message_events` (`schema.ts:1359`),
`correspondence_email_events` (`schema-correspondence-email.ts:80`, folded into
section 2), `sage_square_webhook_events` (`schema-sage.ts:398`),
`netsuite_sync_log` (`schema-netsuite.ts:46`), `notification_events`
(`schema.ts:413`).

**E. Decisions**

`project_duplicate_decisions` (`schema.ts:996`),
`project_number_review_decisions` (`schema.ts:1042`),
`buildertrend_identity_decisions` (`schema-buildertrend.ts:417`).

### How they overlap and differ

`project-timeline/server.ts` already shows the right read pattern: it combines
`activity_events`, `project_todo_events` and `equipment_log_entries` into one
timeline in code. The tables themselves are mostly not duplicates, because they
answer different questions:

- **Activity (A)** is a human sentence (`summary`, `category`, `actor_name`
  captured at the time) shown to staff. Lossy on purpose.
- **Audit (B)** is a machine record. The generic shape already exists:
  `project_profile_audit_events` has `event_type, entity_type, entity_id,
  before_json, after_json, actor_user_id`. The other group B tables repeat the
  idea with their own columns (`contact_merge_events` has source and destination
  snapshots, `permission_audit_events` has previous and next access level).
  They differ only in subject and in having no `project_id`.
- **History (C)** has typed, queried columns (`from_status`, `to_status`,
  `revision`, `daily_log_id`), and some rebuild state (selection snapshots,
  budget revisions, correspondence revisions). Collapsing them into a generic
  JSON log would lose indexes and referential integrity. Keep.
- **Ledgers (D)** exist for idempotency (unique provider event id) and retry
  state, not for audit. Keep each with its integration, except the email one
  noted in section 2.
- **Decisions (E)** are authoritative state ("this pair is not a duplicate")
  read to filter lists. They are records, not logs. Keep.

Actual duplication to remove:

- Group B is 8 tables doing one job with different column names, and 4 of the
  writers break the one-writer rule or use raw SQL.
- Activity and audit are written side by side at many call sites with two
  helpers and two payload shapes.

### Target model

Do not build one universal log. Consolidate by purpose:

1. **`audit_events`** replaces group B. Columns: `id, organization_id,
   project_id (nullable FK), actor_user_id (nullable FK), subject_type`
   (exported `AUDIT_SUBJECT_TYPES` const), `subject_id, action` (shared list per
   subject type), `before_json, after_json` (each with a `// snapshot:`
   comment), `created_at`. Indexes `(organization_id, subject_type, subject_id,
   created_at)` and `(project_id, created_at)`. It is the existing
   `project_profile_audit_events` generalised: extend that table with the
   missing columns and add subject types, rather than creating a parallel one.
   The target is polymorphic, so subject types are named in one const and the
   writer validates them.
2. **A single write helper** `recordEvent({ activity?, audit? })` in the
   audit/activity module that writes the activity row and the audit row in one
   `db.batch`, so the two cannot disagree. Existing helpers become thin
   wrappers.
3. **A read view** `event_stream_v` (a SQL `VIEW`, additive) over
   `activity_events`, `project_todo_events`, `project_warranty_claim_events` and
   `project_rfq_manual_response_events` for timelines, replacing the in-code
   combination. No data moves for groups C-E.

Owner: `domain/project-audit/store.ts` for `audit_events`; each group C table
keeps its own domain store.

### Migration path

1. Migration: add columns to `project_profile_audit_events` (nullable
   `project_id`, `subject_type`, `subject_id`, `action`) and create
   `event_stream_v`.
2. Dual-write: contact, permission, plugin and Sage-contact writers call
   `recordAudit` in addition to their current insert. Move the raw SQL in
   `domain/contacts/store.ts` and the action-level writers behind their domain
   stores first (this alone clears several baseline violations).
3. Backfill `scripts/backfill-audit-events.mjs` (dry-run default): map each
   group B row to a subject type and action, keeping the old `created_at`; the
   dry run lists any row it cannot map.
4. Switch reads: group B has no readers, so the first reader is a new admin
   audit page. Switch `project-timeline/server.ts` to the view.
5. Freeze old group B writers.
6. Archive the group B tables. Groups C-E are untouched.

Risk: medium-low. Low volume, write-mostly. The risk is moving writers out of
actions and raw SQL while keeping them atomic with the main change. Effort:
22-28 h (writers behind stores 8, schema and helper 4, backfill 4, view and
timeline 3, tests 5-7, rollout 2).

## 5. JSON columns holding lists

The standard allows JSON only for raw provider payloads and named snapshots.
These columns store lists that other rows should point at:

| Column | Schema | Holds | Writers / readers |
|--------|--------|-------|-------------------|
| `owner_project_updates.source_daily_log_ids` | `schema.ts:1901` | daily log ids | `domain/field/store.ts`, `owner-update-drafts.ts`, `owner-update-publish.ts`, `daily-log-workspace.ts`; also `actions/daily-log-delete.ts` and `daily-logs/delete-rules.ts`, which must scan the JSON to find dependants |
| `owner_project_updates.selected_photo_ids` | `schema.ts:1902` | photo ids | same, plus `owner-updates/attachment-taxonomy.ts`, `owner-update-draft-editor.tsx` |
| `correspondence_composition_drafts.recipient_user_ids` | `schema-correspondence.ts:124` | user ids | `domain/correspondence/store.ts`, `correspondence/saved-drafts.ts`, `send.ts`, `validation.ts` |
| `correspondence_drafts.attachment_ids` | `schema-correspondence.ts:68` | attachment ids | `domain/correspondence/store.ts`, `send.ts`, `project-email-composer.tsx` |
| `project_archives.source_record_ids` | `schema-project-archives.ts:14` | external record ids | `project-archives.ts`, `actions/project-archives.ts` (external ids: FK-exempt, still a list) |
| `project_client_meetings.guest_emails`, `.staff_emails` | `schema.ts:2071` | email addresses | `client-meetings/*`, `morning-plan/server.ts`, `project-calendars/sync.ts` |
| `my_compass_calendars.other_names` | `schema.ts:2115` | alias names | `my-compass-calendar/items.ts`, `morning-plan/server.ts` (moves with section 1) |
| `project_rfq_email_deliveries.cc_emails_json`, `.document_links_json` | `schema-rfqs.ts:14`, `:16` | emails, links | `actions/project-rfq-email.ts` |
| `project_field_cost_codes.codes_json` | `schema.ts:1616` | cost codes | `actions/field-cost-codes.ts`, `field/cost-codes-server.ts` |
| `contract_document_templates.department_codes_json` | `schema-contracts.ts:26` | department codes | `actions/contract-templates.ts`, `contract-packets.ts` |
| `client_signers_json` | `schema-contracts.ts:115`, `schema-estimates.ts:111` | signer list | contract and estimate stores |
| `owed_json` | `schema-trade-docs.ts:115` | owed document kinds | trade doc store |
| `capabilities_json`, `scopes`, `hashtags_json` | `schema-participants.ts:34`, `schema-mcp.ts:17`, `schema-social.ts:86` | enum-like values | respective modules |
| `tags` (comma separated) | `schema.ts:4204` | tags | notes module |

Not in scope: provider payloads and snapshots (`raw_payload_json`,
`*_snapshot_json`, `before_json`, `after_json`, `specification_json` and the
like) are allowed when they carry a `// json:` or `// snapshot:` comment. Add
those comments in the same PRs where missing.

### Target model

Child tables with a unique pair and an index on each foreign key:

- `owner_project_update_source_logs(update_id, daily_log_id)` and
  `owner_project_update_photos(update_id, photo_id, position)`. Foreign keys to
  daily logs and photos make deletes safe: today deleting a log or photo can
  leave a dangling id in a draft that the delete rules find by scanning text.
- `correspondence_composition_draft_recipients(draft_id, user_id)` and
  `correspondence_draft_attachments(draft_id, attachment_id)`.
- `project_client_meeting_attendees(meeting_id, kind, email, user_id nullable)`.
  Keep it separate from `work_calendar_event_attendees`; meetings are not
  events (section 1).
- `calendar_target_aliases` (section 1).
- RFQ cc and links: child rows under the shared `email_deliveries` model from
  section 2.
- `project_field_cost_code_entries(project_id, cost_code)`,
  `contract_template_departments(template_id, department_code)`.
- `project_archive_sources(archive_id, source_record_id)`: external ids, no FK,
  unique on the pair.
- Enum-like value lists (capabilities, scopes, owed kinds, hashtags): a child
  table per owner, or a validated `// json:` comment where the list is a closed
  enum with no query need. Decide per column in review; do not convert by
  default.

Each child table is owned by the module that owns its parent.

### Migration path

The same recipe, per column. The old JSON column stays, so dual-write means the
store writes the JSON and the rows from the same validated array. The backfill
parses each JSON value with a tolerant reader and reports malformed or dangling
entries instead of failing. Switch reads to the child tables (joins replace
`JSON.parse` and text scans), then freeze the JSON writers. The old column is
read only as a fallback during the dual-read window.

Risk: low per column, medium overall because there are many call sites (the
owner-update fields alone are touched by about a dozen files). Effort:

| Group | Hours |
|-------|-------|
| Owner update source logs and photos | 8-10 |
| Correspondence draft recipients and attachments | 5-6 |
| Meeting attendees | 4-5 |
| RFQ cc/links, cost codes, template departments, signers | 6-8 |
| Archive sources | 2-3 |
| Enum-like lists (review and decide) | 2-4 |
| Total | 27-36 |

## Recommended order

Lowest risk and most reuse first; the high-risk live-inbound work last, after
the shared patterns are proven.

| # | Work | Why this position | Effort (h) | Risk |
|---|------|-------------------|------------|------|
| 1 | Saved views (section 3) | Small, no integrations; proves the recipe and the dry-run script template | 8-10 | Low |
| 2 | JSON id lists, owner updates first (section 5) | Fixes real dangling-id deletes; independent of everything else | 27-36 | Low-medium |
| 3 | Audit and activity (section 4) | Clears several one-writer violations; no readers to break; lets later work emit audit rows | 22-28 | Medium-low |
| 4 | Calendars (section 1) | Contained to sync jobs; after JSON lists so aliases and attendees are already child tables | 28-36 | Medium |
| 5 | Email transport (section 2) | Live inbound matching; last, with dual-read | 36-48 | High |

Total: about 121-158 hours. Items 1-3 can run in parallel with different owners
because they touch different stores. Items 4 and 5 should not overlap (both
touch notification and sync entry points), and each needs one owner on the
shared surface.

## What stays separate, and why

| Not merged | Reason |
|-----------|--------|
| `work_calendar_events` vs `google_calendar_events` | Compass owns one; the other is a cache of someone else's calendar |
| Calendar connections and selections | Credentials and per-user choices |
| `project_client_meetings` vs calendar events | A business record with a transcript and a log, not a time slot |
| `project_correspondence*` vs email transport | The record vs how it travels |
| `messages` / channels, `staff_message_*`, `goto_inbound_events` | Different channel, audience, lifecycle |
| `notification_events` | Fan-out across channels; only its email delivery rows overlap |
| `custom_dashboards`, `organization_feature_settings` vs saved views | A generated artifact and company settings, not per-user filters |
| Group C per-record history, group D ledgers, group E decisions | Typed columns, idempotency keys, or authoritative state; a generic log loses all three |

## Guardrails for all five

- Every new table passes `schema-integrity-standard.test.ts` on the first
  commit: foreign keys with indexes, unique link pairs, shared `enum:` lists.
- No table rebuilds, no `DROP`, no `ALTER` that changes an existing column.
  Read the live production schema before each migration, because production can
  hold columns from migrations that are not on `main`.
- Migrations touching production run from a `main`-based worktree after
  confirming the pending list.
- Backfills are idempotent, dry-run by default, batched per organization, and
  print a before/after count so a reviewer can accept or reject them.
- Each phase ships as its own PR: migration and dual-write first, read switch
  second, writer freeze third. No phase depends on a later one to be safe.
