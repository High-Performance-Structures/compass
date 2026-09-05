# Project messaging implementation checkpoint

This implementation is isolated on `martinevogel/project-messaging`, updated to the current main branch before release. The release target is the native project messaging UX for current users, with verified Buildertrend history added incrementally. Historical recovery and external email/text completion do not block this native release. Production migration and deployment results are recorded below when verified; historical publication and external sends are separate operations.

## Implemented application path

A project correspondence inbox and shared reader/composer support Internal staff, Owner, and the combined Sub/Vendor workspace. Native correspondence addresses named people; choosing a person does not merely mention them in a shared channel. Current project permission and explicit conversation membership are required, and each message has its own recipient grants.

The core persists messages, recipient snapshots, staged file associations, and Compass availability outbox entries in an atomic D1 batch. Transaction guards check current access, participant version, and attachment ownership/readiness. A stable request identity and content fingerprint prevent duplicate sends after an uncertain response. Reusing a send identity for different content is rejected.

Chronological pagination uses original UTC timestamps with a sequence tie-breaker. Late historical backfill remains in its original chronological position. Imported messages retain author presentation, exact body, and original dates. Original read status is unavailable; the import path does not manufacture receipts or unread counts.

Native message edits/retractions retain an audit revision. Retraction hides the body and files without purging evidence. Imported messages cannot be edited through ordinary messaging. Personal save, follow-up, archive/restore, versioned draft discard, and staff close/reopen are separate operations. A new reply reopens a closed conversation.

Authenticated visible-message observations mark only the specific revision displayed. Shared opening receipts are distinct from private unread state and can be disabled per conversation. A receipt describes opening in Compass, not comprehension, acknowledgement, email delivery, or contractual approval.

Search checks the same project/conversation/message grants as the reader, including historical body text. File retrieval checks the actual message grant, current participation, and retraction state. Staged files use a dedicated private organization Drive folder; external project-folder sharing cannot expose unsent files.

## Local enablement and compatibility

Apply the new migrations to a disposable local database first. Production enables the native path with `COMPASS_CORRESPONDENCE_ENABLED=true`. This controls feature availability only; project authorization and per-message grants remain enforced. An explicit `COMPASS_CORRESPONDENCE_PROJECT_IDS` allowlist remains available for restricted pilots. With both settings absent or disabled, existing conversations remain operational and the new tables are not queried.

When enabled, the existing internal project Conversations route opens Messages. Owner and Sub/Vendor conversation sections use the same new inbox, with earlier Compass channel links retained. Existing channel/message routes remain operational. Staff viewing an audience workspace sees a labeled staff inbox; this is not an impersonated participant preview.

Attachment storage requires `COMPASS_CORRESPONDENCE_STAGING_FOLDERS` (JSON organization ID to private folder ID) and `COMPASS_CORRESPONDENCE_DRIVE_USER` (dedicated mailbox). The folder must be inspectably private and outside a shared drive. Unconfigured storage returns an actionable error before a file is included in a message. Removing an unused staged file retires it in the database before Drive trash, preventing a race with sending.

## History recovery and transport boundaries

The evidence reconciler and publication rehearsal builder run offline. They classify exact/excerpt/missing bodies and proven/unproven recipients; validate project/account mappings; generate silent, repeatable publication SQL; and test rollback while preserving native replies. Real source packages and SQL containing message bodies must remain outside tracked artifacts.

Source recovery is owned by the separate **Complete Buildertrend data cutover** task (`01a04adf-81f1-7663-8345-00cf7f3017d4`). Buildertrend access is confirmed available. This worktree supplies the authorized presentation and reviewed projection contract; it does not start a competing capture or overwrite the cutover task’s archives. The integration handoff requires original sender/To/Cc/Bcc, stable source IDs/threading, UTC dates, full bodies, byte-backed attachment manifests, project mappings, and explicit held records.

The retained audits do not establish an exhaustive source denominator or complete original To/Cc/Bcc evidence. No participant/project is certified Ready by this checkpoint. Recovery must supply the original evidence, reviewed account mappings, usable attachments, per-participant reconciliation, and an actual preview before activation.

The email adapter is separately disabled by `COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS`. It prepares stable reply addresses and exact message references, durable per-recipient delivery attempts, strict Gmail sending, and an inbound evidence gate. It distinguishes queued, accepted, failed, and uncertain outcomes; Gmail acceptance is not delivery. An uncertain send is never blindly retried.

The adapter is not a claim that external email participation is operational. Production invocation, authenticated inbound sender evidence, verified provider behavior, bounce handling, operational recovery, and the two-person delivery pilot still need completion. Current Gmail polling provides header-only sender identity and cannot pass that evidence gate by itself. Email-only contacts who have not activated Compass are not yet supported by the active-user participant model. Existing GoTo SMS remains linked intake; outbound SMS is not implemented here.

## Follow-up after the native UX release

- Recover complete source bodies, original per-message audiences, attachments, and verified account mappings; rehearse real participant histories without publishing them.
- Complete pre-activation identity binding and staff simulation of one external participant's actual grants, including accepted exceptions and readiness reporting.
- Complete and verify email-only recipient identities and the production email invocation/recovery path. Do not enable outbound correspondence until reply routing is also verified.
- Complete all-project inbox/direct-message navigation unification, legacy message deep-link mapping, and device/offline acceptance beyond the project inbox.
- Validate inbox summary query cost at real project volumes and replace per-conversation reads with batching/pagination before large-history rollout.
- Run the controlled staff/owner/Sub/Vendor pilot and reconcile historical totals before external activation. Confirm retention and consequential purge policy separately; no hard-purge feature is included.

The approved product plan remains the target. Deploying the native UX is not certification that historical migration or external delivery is complete. Existing channels and direct messages remain accessible from the new project inbox.

## Validation checkpoint

- Focused Vitest: 75 tests across ten suites passed, covering tenant/project separation, historical message grants, role/revocation races, chronology beyond 200 messages, maximum recipients, atomic sends and drafts, attachment access/lifecycle, and email delivery state handling.
- Full Vitest: 1,668 tests across 300 suites passed after updating the route inventory for the new Messages page.
- Offline evidence/publication scripts: 13 Node tests passed, including replay, held evidence, timezone normalization, and rollback preserving native replies.
- TypeScript and whitespace checks passed (standalone validation excludes generated Worker output). The Next.js production build and OpenNext Worker build passed. Focused ESLint passed without errors or warnings.
- Running local fixture: desktop reader, reply, search, receipt preference, and draft recovery verified. A 390 × 844 browser viewport opened a conversation and reply composer and returned to the inbox; document width remained 390 pixels. This is browser QA, not a physical-device/offline pilot.
- A structured-review finding about null edit timestamps was accepted and fixed; browser-to-database verification confirmed an unedited visible message now gets an opened timestamp. Header observation also passed with a 7,095-pixel message in an 844-pixel viewport, so long correspondence does not require an impossible half-message visibility threshold.
- Further accepted review findings fixed pending-send file/discard controls and project access with a different active organization. Local review also corrected stale edit/retraction merges, exact search navigation, post-send draft versions, archive filtering, and composition-save error recovery. Browser checks confirmed polling edits/retractions, frozen unknown-send controls with Retry available, archive/restore, untouched edit text surviving polling, and Edit and Retract remaining locked during an uncertain send. Sent-draft cleanup also passed spaces, tabs/newlines, and Unicode whitespace cases.
- Definite pre-write send rejections now allow correcting the draft; uncertain outcomes retain the exact request for safe retry. Browser QA committed a message, deliberately lost the response, waited through polling, and retried: exactly one message persisted and the draft was empty. Immediate reply and new-message sends also flushed current edits and left no older saved draft behind.
- Browser regression with more than 50 messages confirmed successful edit/retraction immediately updates an older loaded message. Immediate dirty reply navigation to a new message retained the saved draft.
- A delayed-network browser check confirmed conversation switching cannot expose stale Reply controls; dirty replies survive Edit/Cancel and an ongoing edit cannot be replaced by New.
- Private production attachment storage passed owner-only ACL verification and an upload/download byte comparison; the temporary test file was trashed.
- Structured autoreview was invoked with `--mode local --engine codex --model gpt-5.5 --thinking high --no-web-search`; the final closeout returned no accepted/actionable findings. The last corrections explicitly block submitting during draft navigation/discard and declare the verified attachment settings as required production secrets.

The cutover task's September 5 handoff describes dated September 3/4 snapshots, not a fresh production census or a complete source package. Its 29 exact-body observations remain held because original recipient and attachment evidence is unproven.

A later fresh capture supplied two actual project-message samples with full rendered bodies and outer display headers. The intake schema is compatible after enrichment; original account/recipient identities, timezone, Bcc, and embedded file bytes remain held. The observed Inbox count belongs only to that project/folder scope.
