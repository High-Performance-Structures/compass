# Project messaging and Buildertrend continuity

Status: approved product target; implementation is underway in the isolated messaging worktree. See [implementation checkpoint](project-messaging-implementation-2026-09-05.md) for completed code, proof boundaries, and remaining release work. Source acquisition remains with the Complete Buildertrend data cutover task; no historical publication or external delivery is certified by this plan.

## Product outcome

An existing Buildertrend owner, subcontractor, or vendor activates Compass, opens Messages, recognizes their project correspondence, and continues a conversation without starting over. Internal staff use the same correspondence records from their project workspace or an all-project inbox.

Success means complete, authorized, recognizable correspondence for each participant, rather than a count of imported database rows. The source may be Buildertrend, Compass, or email; the user's primary organizing concepts are project, subject, and people.

Staff Message Desk remains a separate operational intake tool for missed calls, texts, and other incoming messages. Its internal assignment notes do not automatically become correspondence with a caller. An explicit “Start project conversation” action may create a linked conversation using reviewed text and an identified recipient.

## Decisions

There are three workspace experiences: Internal staff, Owner, and Sub/Vendor. Subcontractors and vendors share navigation, messaging behavior, and onboarding. Person, company, project, and correspondence permissions still determine the content each participant can access; a shared workspace experience does not create a shared partner inbox.

- Use subject-based project correspondence with chronological replies, alongside internal direct messages. Put both behind one Messages entry point, with clear filters. Retain voice as a separate capability.
- Project Messages defaults to that project's conversations. Staff can switch to all assigned projects. External users can switch among their authorized projects. These are views of the same records, not copies in different inboxes.
- Provide Inbox, Unread, Needs reply, and Saved views. Needs reply is an explicit personal follow-up flag; a reply-request workflow can assign a responsible person and optional due date. Do not infer a contractual obligation or overdue response from ordinary text.
- Recipients, readers, and delivery are separate, visible concepts. Choosing a person creates correspondence addressed to that person. An @mention only draws attention within an already-authorized conversation.
- Original correspondence retains subject, original sender identity, recipients, source timestamps, body, attachments, and source provenance. Do not relabel historical messages as sent by a generic system user in the presentation.
- Imports never send notifications or mark old correspondence newly unread. Historical read/delivery states remain “Not available” unless supported by source evidence.
- Support participation by verified email for external recipients who have not yet activated Compass, subject to explicit recipient authorization and a proven mail integration. An address is not silently treated as a working Compass account.
- Launch is gated by per-participant migration reconciliation and delivery verification. Do not claim “all your history is here” while unresolved records remain.

## Screen design

Desktop uses a project navigation rail, a conversation list, and a reading/reply area. Rows show subject, correspondent names, latest message excerpt, date, unread state, and follow-up state. Imported history appears naturally in chronological/recent activity ordering; “Buildertrend” is secondary provenance rather than the conversation name. History is also searchable and filterable by source/date.

The reading area shows:

1. Project and subject.
2. “Visible to” with named external participants and the specific authorized staff group. The staff group expands to current names; it is never shorthand for the entire company unless that access is explicitly intended.
3. Chronological messages with original From/To/Cc and timestamps. Long exchanges can collapse earlier entries, with a clear count and a working “Load earlier” control.
4. Files and photos in context, with readable previews where supported and a download action through authorized storage. Missing files have honest labels rather than dead Buildertrend links.
5. A composer with visible To/Cc recipients, attachments, saved-draft feedback, and an optional reply request. Enter creates a new line; Ctrl/Cmd+Enter sends with a visible keyboard hint.
6. Per-message delivery details accessible by a labeled button. Expanded details distinguish Compass availability/opening from email/push delivery.

New message requires a project, subject, and explicit recipients. Contacts are searchable by person, company, and trade. Display whether each can receive Compass, email, or neither before sending. No global external directory is exposed to owners or partners. Owners/partners initially choose authorized project staff; staff can create a permitted mixed-participant exchange after seeing its audience.

On mobile, list and conversation are separate screens with an obvious back action. The subject and audience remain discoverable; composing/replying uses full width. Visible action menus replace hover-only controls. Opening an attachment or following a notification must return to the same message and preserve the draft.

## Access and audience model

| User | Default entry | Historical visibility | New messages |
| --- | --- | --- | --- |
| Internal staff | Assigned project/all-project inbox | Project permission plus explicit correspondence grants; administrative access is separately authorized and audited | Authorized staff, owners, and partners; staff-only correspondence explicitly labeled |
| Owner | Current project inbox | Their original authorized correspondence, including appropriate owner-group exchanges proven by source visibility | Assigned project staff; other approved participants only within the displayed audience |
| Sub/Vendor | Their authorized project inbox, using one shared partner experience | Project/order exchanges involving that verified person or an explicitly proven company/project entitlement, without exposing another partner's correspondence | Assigned project staff and permitted existing participants; quotes/orders can be linked as records |

Historical participation and current access are checked together. Matching a display name, company name, shared project, or unverified email never grants access. A company replacement employee does not automatically inherit another person's historical correspondence. Former participants retain provenance but not current access. A historical sender without a Compass account remains a source identity and does not require a fake active login.

Use message-level historical recipient/visibility records where the audience changed within an exchange. Do not grant everyone the union of every recipient in a long email chain. If source threading is reliable but visibility varies, show each participant only the authorized messages; do not leak hidden bodies through snippets, counts, search, exports, quoted history, or attachments.

For new correspondence, participant changes are explicit access changes. Adding someone starts a new conversation by default, optionally sharing selected, reviewed context; it does not reveal the earlier history automatically. An authorized alternative to share history must preview the affected messages/attachments and record approval. Replying to an imported exchange presents current permitted recipients, identifies unavailable former recipients, and never silently adds people.

Preserve source Bcc evidence in restricted provenance. Do not expose Bcc identities to other recipients or use hidden recipients to broaden a shared thread. New Bcc composition is out of the first release; a separate private message is available.

Internal discussion stays in a distinct staff-only conversation linked to the external correspondence. There is no inline visibility toggle beside an external Send button. Internal notes, missed-call assignments, and replies added to staff-only Buildertrend archives are excluded from external restoration unless separately reviewed for sharing.

## Trustworthy send and read behavior

The send contract validates current access, recipient reachability, participant version, and attachment readiness before committing. Use a client-generated idempotency key so a timeout/retry does not duplicate a message. Commit the message, recipient snapshot, attachment links, and notification outbox in one D1-compatible atomic batch after validation. Uploads occur first into authorized staging; failed uploads remain retryable and block inclusion in the send. Users can explicitly remove a failed attachment and send the remainder.

Separate message persistence from delivery attempts:

| Label | Evidence required |
| --- | --- |
| Sending | Client request in flight |
| Saved in Compass | Durable server acknowledgement; only authorized participants can retrieve it |
| Email queued | Durable outbox entry, not delivery |
| Email accepted / delivered | Actual provider acknowledgement / delivery event, respectively; never upgrade accepted to delivered without evidence |
| Delivery failed | Provider failure or exhausted retry with a actionable retry/change-address path |
| Opened in Compass | Authenticated recipient visibly opened that specific message; does not imply reading comprehension or approval |
| Read status unavailable | Imported history, unsupported observation, or recipient preference disables receipts |

An emailed message without a receipt is not assumed unread. Email pixels and push acceptance are not read receipts. Private unread cursors work regardless of whether shared read receipts are enabled. “Acknowledged” is an explicit optional action, separate from “Opened”; messaging acknowledgement does not approve a change order, contract, or other formal record.

Unread advances only through messages actually presented in an active visible conversation. Opening a search hit does not mark later unseen messages read. Reading clears corresponding unread counts across inbox, project view, and devices. Imported history starts at a migration baseline without changing unread state for newer live messages.

Persist drafts per user/project/conversation/recipient set, with an explicit Discard action. Browser/device recovery must not restore a prior account's draft after logout or account switching. Clear account-scoped caches on logout and apply expiry. Phase-one offline support allows recoverable drafting and an explicitly visible pending-send queue; reconnection revalidates authorization and audience before any send. Do not silently send if recipients or access changed.

Live updates use one ordered change feed covering messages, edits, deletions, attachments, reply counts, delivery states, and read cursors. Cursor pagination uses a stable timestamp/ID or monotonic sequence and never discards the older page just requested. Polling is acceptable initially if all surfaces are correct and reconnection is visible; WebSockets are a later performance choice, not a prerequisite for correctness.

Search and notifications deep-link to conversation plus message. Fetch authorized context around the target, highlight it, and open the right reply position on desktop/mobile. Drawer and full-page views share the same rendering, draft, and reply behavior.

## Buildertrend restoration workflow

### 1. Inventory and reconciliation

Build a canonical inventory by source account, job/lead, conversation, message, attachment, and participant. Reconcile job/lead project aliases before publication. Include inbox and sent items, replies, deleted/hidden status where recoverable, and attachments. Deduplicate by stable source IDs; use hashes as evidence, not as the sole identity key. Repeated identical text is not necessarily a duplicate. Preserve raw immutable captures and original timezone/date labels alongside normalized dates.

Classify each record: exact body, excerpt only, missing body, complete/partial attachments, proven/uncertain participants, proven/uncertain threading, and project mapping status. Source page text must not be mistaken for an exact message body. Recover full details from retained authorized source bundles or the original source if still available; do not promise source availability.

### 2. Establish identities and visibility

Create mappings between Buildertrend participant IDs, verified email identities/aliases, Compass project contacts, and activated accounts. Require a verified account claim plus project entitlement, rather than a name or fuzzy-email match. Conflicting/shared/recycled addresses and company-level inheritance go to a staff review queue. Retain evidence and reviewer decisions.

Recover original To/Cc/Bcc and source visibility. Confirm thread IDs or reply relationships from original evidence; subject similarity can suggest review candidates but cannot merge conversations automatically. A body containing an email address is not recipient evidence. Audit quoted material for visibility when producing a shared rendering.

### 3. Reconstruct correspondence

Store source messages once with explicit grants and participant snapshots. Render the same authorized records in staff and external inboxes. Avoid copying every external user's history into separate mutable channel messages. If the legacy storage model requires transitional copies, maintain canonical source links, unique source constraints, and a retirement path to prevent split histories.

Retain original sender presentation, subject, dates, ordered replies, file names, and source provenance. Keep the staff source archive intact as the recovery authority. New Compass replies are new native messages linked to the restored conversation, never edits to imported evidence.

### 4. Preview each participant

Generate a staff-only review showing exactly what one intended external participant will see, alongside reconciliation totals and missing items. Preview is a permission simulation of that participant's actual grants, not the reviewing staff member's membership view.

For each participant/project, reconcile expected authorized source messages against visible restored messages, exact bodies, and available attachments. Verify unauthorized messages and attachments are absent through direct links, search, previews, notifications, and exports. Count conversations separately from messages and files; record why every excluded or held item is excluded.

### 5. Prepare before activation

Complete recovery and visibility mapping before invitations wherever possible. Activation links a verified account to a prepared history grant set and presents the inbox immediately; it does not attempt a long import on first login. Existing active accounts receive the same preparation/backfill workflow. Matching must be idempotent and resistant to simultaneous invitation acceptance.

A participant/project is Ready only when the expected authorized inventory is reconciled, bodies/files are complete or a concrete exception has been accepted, and recipient/access checks pass. Partial histories remain explicitly Partial; do not convert a source outage into a false completeness claim. Any user-visible gap gets a specific explanation and a contact/help path, not a dead archive link.

Publication is silent and separately recorded from source capture. Do not call normal send/mention endpoints during restoration. Retain a publication manifest and access-grant version for rollback. Rollback withdraws incorrect grants or projections while preserving source evidence and any legitimate new replies for controlled reconciliation.

## Email and text continuity

Email-style composition is part of the first release, and genuine email participation is required for recipients relying on email. Reuse existing Compass email identity, reply-tracking, and inbound routing components after verifying their current behavior. Do not assume that notification email is already a bidirectional correspondence service.

Outbound correspondence uses a stable per-conversation reply address/token and Message-ID. Inbound replies use In-Reply-To/References plus the token, validate the sender against authorized participants, deduplicate provider events, handle attachments, and suppress delivery loops/auto-replies. A reply from a newly forwarded address is held for staff routing; receiving a token does not grant portal access. Authenticate provider callbacks and treat sender headers alone as insufficient evidence. Forwarding/email cannot expand conversation access implicitly.

Define provider bounce/complaint callbacks, delivery-event availability, retries/backoff, rate limits, attachment limits, malware/content handling, and per-recipient preferences before enabling production delivery. Distinguish correspondence delivery from optional reminder notifications; communicate settings so disabling a push alert does not unexpectedly disable all correspondence.

SMS remains a linked intake source initially. Surface the actual sender/project routing when proven; unmatched texts stay in intake review or Staff Message Desk. Do not imply bidirectional SMS support until outgoing sender identity, replies, participant routing, and delivery have been verified. Subject tags/project codes are optional intake aids, not the main messaging interface shown to owners.

## Data and implementation boundaries

Proposed additive schema (names to align with existing tables during implementation):

- `project_correspondence`: organization/project, subject, status, canonical source thread key, created/last-activity timestamps, participant version.
- `correspondence_messages`: conversation, stable sequence, native/source kind, author identity, body, source timestamps, original reply reference, idempotency key; immutable imported body plus native revision history.
- `correspondence_participants` and `message_recipients`: identity, role, historical To/Cc/restricted Bcc, current grants, effective scope, evidence, revocation, invitation/account linkage.
- `correspondence_attachments`: source/native identity, authorized storage locator, filename/type/size/hash, transfer/verification state, message association.
- `correspondence_delivery_attempts`: message, recipient, transport, provider IDs, queued/accepted/delivered/failure timestamps, retries; unique provider-event keys.
- `correspondence_user_state`: read cursor, saved/follow-up/archive state, receipt preferences; user and conversation uniqueness.
- `correspondence_drafts`, `migration_publications`, and identity/source mapping records: versioned drafts, completeness/review state, immutable provenance, publication/grant manifests.

Reuse existing notification outbox/source-staging/audit structures where they satisfy these contracts. Do not add parallel tables only to duplicate an existing responsibility. New migrations only; UUID/text IDs, ISO dates, indexes beginning with organization/project/conversation for common scoped reads. Enforce tenant, participant, idempotency, source identity, and event deduplication invariants in the database where possible.

Compass UI mutations use server actions returning discriminated success/failure results and path revalidation. Authenticated provider webhooks and upload transports invoke shared server-side authorization/services. File delivery, search, export, and live updates apply the same access policy as message reads. Keep source/notification provider concerns server-side.

Implement one correspondence list/thread/composer family shared by staff and audience workspaces. Keep internal DMs distinct in scope but under the same inbox/navigation and reliable send/read infrastructure. Preserve existing channel URLs via an authorized redirect/adapter. Imported message links resolve to their canonical restored message when authorized, otherwise give an appropriate unavailable state without exposing details.

## Complete record lifecycle

- Drafts: create, edit, discard/delete with appropriate recovery feedback.
- Native sent messages: authors may edit or retract within the defined product policy; retain revisions/audit and a visible edited/retracted marker. Explain that already-delivered email cannot be recalled. Prevent read receipts from silently certifying a newly edited version.
- Imported messages: immutable evidence; authorized staff can correct mapping/display metadata with audit or withdraw an erroneous publication. Do not offer ordinary edit/delete of original evidence.
- Conversations: personal archive/restore; Save/Unsave; follow-up flag/clear. Staff may close/reopen a shared conversation without erasing history. New authorized replies reopen it.
- Consequential deletion: permission-gated confirmation, dependency analysis for messages/files/replies/linked records, retention checks, audit, and reversible tombstones or recovery. No cascade purge of project evidence as a side effect of removing a participant. Retention period and hard-purge authority follow the organization's explicit retention policy before purge is enabled.

## Delivery sequence and exit criteria

| Stage | Work | Exit criterion |
| --- | --- | --- |
| A. Evidence baseline | Source census, historical visibility recovery, identity mappings, provider capability audit, representative owner/sub/vendor sets | Quantified completeness report and actionable held-item queue; no unsupported “complete” claims |
| B. Access and reliable core | Additive schema, canonical identities, grants, idempotent sends, attachments, outbox, draft/read/change-feed services | Access-boundary and failure/replay tests pass |
| C. Restored inbox | Subject list, thread reader, audience display, imported provenance, exact search/deep links, mobile flow | A staff member can review exactly what each pilot participant will see |
| D. End-to-end correspondence | New/reply flows, verified email replies, delivery evidence, preferences, recovery, direct-message integration | Two real test participants can exchange messages/files and see truthful states across supported devices |
| E. Migration rehearsal | Dry-run participant publication, source/target reconciliation, negative visibility checks, silent import, rollback rehearsal | Each pilot participant/project meets the Ready criteria |
| F. Controlled launch | Staff pilot, then one prepared owner and two participants in the shared Sub/Vendor workspace, followed by project batches | Pilot tasks completed with no material access/delivery/history issues; monitoring and support runbook ready |

Recovery work in A and design work in C can overlap conceptually, but no external historical publication precedes access validation. Existing DMs and Staff Message Desk stay operational while the correspondence migration is developed. Use feature flags by organization/project/cohort; deploy schema before readers/writers, and keep old routes compatible through cutover. No date estimate is credible until the source completeness census is done.

## Verification and operational acceptance

Required automated tests cover identity collisions, revoked users, cross-tenant/project access, owner/sub/vendor separation, mixed historical audiences, Bcc, quote/attachment leaks, unauthorized search/deep links, old-to-new URL mapping, idempotent activation/import/send, same-timestamp pagination, history beyond 200 messages, concurrent read updates, edit/delete events, unread on visibility, and draft account isolation.

Fault tests cover network loss before/after commit, upload interruption, browser reload, server deployment during composition, duplicate/out-of-order provider callbacks, email bounce, spoofed/unknown inbound sender, notification retry exhaustion, stale participant version, migration replay, and rollback without losing new replies.

Usability acceptance uses prepared staff and owner accounts plus two Sub/Vendor accounts (one subcontractor and one supplier) to verify the shared experience and isolation between participants: locate a known Buildertrend subject; open its oldest reply and attachment; identify every current reader/recipient; reply; see truthful delivery; find it from search/notification; save a draft and recover it; clear unread by viewing; flag/clear follow-up; verify another partner's conversation is unavailable. Repeat on a narrow mobile viewport and actual supported mobile/desktop shells.

Operational monitoring separates send persistence success, transport failures, stuck outbox items, mapping conflicts, import body/file gaps, unauthorized-access denials, and stale live-update connections. Keep operational metrics out of ordinary user screens. Staff has a concrete recovery queue and can explain every migration exception.

## Current evidence and known gaps

- The current project-message importer writes staff-only channels and register previews (`scripts/build-buildertrend-message-import.mjs`). A preview alone is not a complete message.
- The existing owner-history promotion script copies reviewed source messages and resets thread linkage. Its source audience check expects `organization`, while the current importer writes `staff`; do not execute it unchanged as the new migration pathway (`scripts/build-buildertrend-owner-history-promotion.mjs`).
- The September 3 lead-message payload audit records 29 exact bodies and 101 generic-route/page-text records in a specific 130-record set. This is not an all-message completeness estimate (`artifacts/buildertrend-lead-message-payload-field-audit-2026-09-03.json`).
- Current search navigation drops the message ID, older-history pagination trims requested older rows after the 200-message window, open threads lack continuous updates, and mark-read lacks UI callers. Replace these behaviors as part of the shared correspondence reader.
- Existing contact/project grants need reconciliation with source participants. Current staff preview membership is not a substitute for a true external identity simulation.
- Email provider delivery evidence, original source availability, organization retention policy, and unresolved participant identity conflicts must be verified during implementation. Until then, the prototype demonstrates intended behavior using fictional examples; it does not certify production capability or migration completeness.

## Scope of the prototype

The companion interactive mockup demonstrates three workspace views (Internal staff, Owner, and Sub/Vendor), restored subject-based correspondence, current audience disclosure, original headers, delivery evidence, search, follow-up, saved items, draft retention while navigating within the demo, and new/reply composition. All names, messages, counts, attachments, and statuses are fictional. Sending and attachments are local simulations; no production services or personal data are accessed.
