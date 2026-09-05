# Project messaging transport capability audit

Date: 2026-09-05

This audit describes code currently present in Compass. It does not verify
production configuration, provider accounts, delivery events, credentials, or
external delivery.

## Current email behavior

`src/lib/email/compass-email.ts` can submit outbound email through Gmail's
send API or Resend. A successful response is currently labelled `sent`; that
is provider acceptance at most, not evidence that a recipient received the
message. The notification delivery rows retain queue/provider/error fields,
but do not record provider delivery callbacks or retries/backoff suitable for
project correspondence.

`src/lib/email/reply-tracking.ts` creates a unique `cmp-` token in
`email_reply_threads` and produces a plus-address Reply-To value. Current RFI
composition also includes that token in the message body. This is a useful
reply-routing primitive, but the reply thread is scoped to an existing source
record, rather than a canonical correspondence conversation.

`src/lib/email/gmail-inbound.ts` polls the delegated reply mailbox using the
Gmail read API. It records the Gmail message ID in `inbound_emails`, whose
unique index prevents repeat processing of the same Gmail message ID. It
captures `Message-ID`, `In-Reply-To`, `References`, reply token, body, and
attachment metadata. Existing replies may be posted into a staff project
channel or associated RFI; they are not participant-visible project
correspondence.

The polling path authenticates to Gmail through delegated service-account
access. It is not an authenticated inbound-provider callback and no email
webhook, bounce, complaint, or delivery-event endpoint exists in the current
code. Sender authorization for generic project email checks active project
contacts or active organization members, including configured internal mailbox
aliases. The reply-token branch does not currently enforce that the sender is
a current correspondence participant, nor require both the token and the
reply header chain before posting.

Attachments fetched from Gmail have no correspondence-specific malware/content
scan or quarantine state. Existing project routes apply their own attachment
handling. Correspondence must keep attachments held until an authorized scan
and storage policy has cleared them.

## Current SMS behavior

`/api/integrations/goto/inbound` accepts GoTo `INBOUND_MESSAGE` callbacks only
after secret, account, and receiving-number checks. It persists each event in
`goto_inbound_events`, whose unique `message_id` prevents duplicate intake,
then performs async project matching and review routing. Unknown or ambiguous
projects remain in review, and internal staff texts can be dismissed under the
existing routing rules.

The notification service can submit outbound SMS through GoTo (or a configured
generic webhook), but that sends notification text only. It has no
correspondence recipient snapshot, participant authorization, stable
conversation reply identity, provider delivery-event ingestion, or
bidirectional SMS thread model. SMS therefore remains an intake source for the
first correspondence release. Do not label it as correspondence delivery or
offer a text reply workflow until those capabilities are implemented and
verified.

## Required correspondence adapter contract

The reusable policy in `src/lib/correspondence/transport-policy.ts` is pure so
email polling, a future authenticated email webhook, and a future SMS adapter
share the same gate. The adapter must:

1. Authenticate the provider event and record a provider event ID.
2. Atomically claim the provider event's deduplication key before creating a
   correspondence message. A duplicate is suppressed without another write.
3. Resolve a current, same-tenant correspondence, project, and participant
   snapshot. A project guess, subject, token, forwarded address, or sender
   header alone is insufficient.
4. For email, resolve both the stable reply token and `In-Reply-To` or
   `References` against the same conversation. Missing or conflicting evidence
   is held for staff review.
5. Hold unknown and forwarded senders. A staff routing decision may create a
   separate authorized conversation or explicitly add a participant; it must
   not grant access implicitly.
6. Suppress known delivery loops and automated responses; hold attachments
   until transfer/content policy succeeds.

Run the policy after callback/API validation and the dedup claim, and before
the atomic correspondence-message/attachment/grant write. Persist each held or
suppressed outcome in the future provider-event audit record so operations can
explain it without exposing message contents to unauthorized users.

## Delivery-state contract

Correspondence delivery is separate from persistence and from notification
delivery. A durable message plus delivery-attempt outbox is **queued**. A
successful Gmail, Resend, or GoTo send response is **accepted**, if it supplies
provider acknowledgement; it is not delivered. Only an authenticated provider
delivery event can mark an attempt **delivered**. Provider rejection or
exhausted retry is **failed**. Neither acceptance nor delivery is a read
receipt.

The future correspondence delivery-attempt table should retain the immutable
provider event key and accepted/delivered/failure timestamps per recipient.
It should use a unique event key for callback idempotency and retry state that
does not reuse the notification queue's user-preference semantics.

## Integration entry points

- Add a correspondence email adapter alongside, rather than inside,
  `gmail-inbound.ts`. Reuse Gmail parsing and token extraction, then map its
  evidence to `decideCorrespondenceInbound` before native correspondence
  persistence. Leave RFI/staff-channel behavior unchanged.
- Add a correspondence-specific delivery outbox worker beside the future
  server action that persists a native message. It may reuse provider send
  functions from `compass-email.ts`, but must translate `sent` to `accepted`
  and wait for a provider delivery callback before `delivered`.
- Keep `/api/integrations/goto/inbound` and `processGotoInboundMessage` as the
  SMS intake adapter. A later SMS correspondence adapter can reuse its callback
  authentication and message-ID deduplication only after sender/project and
  recipient-reply rules are defined.

## Production gates still open

Before enabling external correspondence delivery, verify the selected email
provider's authenticated inbound and delivery callbacks, bounce/complaint
events, retry/backoff behavior, rate and attachment limits, malware/content
handling, and per-recipient correspondence preferences. Also verify a genuine
external sender and recipient exchange in a non-production pilot. Existing
code does not establish those capabilities.

## Correspondence attachment staging

Unsent correspondence attachments use a separately configured Drive folder,
not a project folder or a child of one. The folder configuration is an
organization-to-folder mapping in `COMPASS_CORRESPONDENCE_STAGING_FOLDERS` and
uses `COMPASS_CORRESPONDENCE_DRIVE_USER` as its dedicated Drive identity. At
runtime Compass verifies the configured item is an untrashed regular folder,
is not in a shared drive, is not shared, and exposes an inspectable ACL made
only of the dedicated user. Missing permission inspection, named users,
groups, domains, or anyone links fail closed. This prevents an externally
shared project root from exposing an attachment while it is still staged.
