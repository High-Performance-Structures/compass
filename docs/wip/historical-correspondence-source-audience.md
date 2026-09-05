# Historical correspondence: source audience is not an access grant

Implementation scope: preserve the complete known source message header independently from current Compass accounts. This permits verified current participants to use migrated messages while original recipients who have not joined remain historical recipients, without access. Never create a fake account, invite, delivery, notification, or read receipt during migration.

## Additive storage contract

Reserve migration `0154_correspondence_source_audience.sql`; 0153 is reserved by the separate historical RFQ worktree. Recheck current main numbering before release.

`correspondence_source_messages`: id TEXT primary key; organization_id, project_id, conversation_id, message_id; source_account_id, source_project_id, source_message_id; source_subject, source_sent_display; source_sent_local (nullable), source_sent_at (nullable), source_timezone (nullable); source_body_sha256, source_evidence_json, captured_at. Unique message_id; unique source_account_id/source_message_id. Validate JSON and SHA shape. Require the source message to be a Buildertrend row in the exact organization/project/conversation via scope checks. Original evidence is immutable; changing mapping or acquisition evidence uses a new reviewed observation, never silently overwrites source facts.

`correspondence_source_recipients`: id TEXT primary key; source_message_id FK to correspondence_source_messages.id; source_recipient_key, source_user_id nullable, source_name, source_email nullable; kind constrained author/to/cc/bcc; source_ordinal integer nonnegative; evidence_json valid JSON. Unique source_message_id/source_recipient_key and source_message_id/source_ordinal. Immutable source facts. No current user ID, invitation status, delivery status, or mutable binding field here. Do not infer that no invitation exists when unknown.

Current `correspondence_participants` and `correspondence_recipients` remain the ONLY access projections. Source recipients never join authorization queries or participant pickers. Future approved account binding inserts grants only for that exact source person's exact messages, with current identity, accepted invitation and project-entitlement evidence; never email/name matching alone or thread-audience union.

## Read behavior

After existing per-message authorization, imported messages with verified source headers show original To/CC names, including unbound people. Never expose Bcc source rows or private evidence JSON. Keep imported read receipts unavailable; no fictitious user IDs for pending recipients. Native messages and older imports without source headers keep current behavior. Source names in a historic header are descriptive, not claims they can receive a new reply; reply composer continues to list current authorized accounts only.

Display the source-sent label when its normalized instant is not proven. Preserve the raw local date/time in metadata; never silently assume server, browser, or capture-machine timezone. Do not treat a local timestamp as a UTC instant. Known native timestamps keep normal formatting. Scope the source metadata lookup to already visible message IDs, organization, project and conversation.

## Import contract and checks

Later publisher must persist exact source audience rows plus only proven account grants, include source-audience/evidence hashes in its frozen manifest, and reject partial state or drift atomically. It must not require all source recipients to have accounts. It must support original author without an account. Use prepared D1 batch statements or reviewed D1 file batch, never SQL BEGIN/COMMIT or naive splitting of body text. Terminal exact-state assertions are mandatory before commit. Preserve existing replies and account read state on replay. Known Bcc/quoted-audience uncertainty remains held; do not silently discard it.

Tests: source-only recipient cannot list/read/download/reply; authorized reader sees exact original To/CC; another thread participant without message grant sees neither body nor header; Bcc hidden; cross-project/org metadata cannot leak; native message behavior unchanged; source-header duplicate/invalid scope or mutation rejected; unknown-timezone label not converted; zero delivery/invitation/read-state writes.

This document does not certify any historical publication or production migration.
