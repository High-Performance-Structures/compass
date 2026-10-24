# Email, Notification, and Activity Standard

Every Compass workflow that emails people outside the company, or that reacts
to something they do, follows the same pattern. Users learn it once: pick
recipients the same way, review before sending, see replies on the record,
get told when something comes back, and find it all in the Activity log.

`src/lib/email/__tests__/email-workflow-standard.test.ts` enforces the parts
that can be checked automatically. The rest is reviewed with the PR.

## Sending

- Send with `sendTrackedEmail` (`src/lib/email/tracked-send.ts`), not
  `sendCompassEmail` directly. It opens a reply thread for the record, puts the
  tracked reply address first in Reply-To, and adds the reply note to the
  message.
- Give the email a record kind in `TRACKED_RECORD_KINDS`
  (`src/lib/email/tracked-record-email.ts`). A new workflow adds its kind
  there, along with its label, notification event type, and link. Job-level
  emails with no record of their own use the project as the record.
- List the person who sent it (or the department mailbox the email comes
  from) in `alsoReplyTo`, so replies still reach them directly.
- Send from Compass. Do not hand users a `mailto:` that relies on them keeping
  Compass copied.
- The server resolves the sender from the active staff account and membership
  in the record's organization. A primary email in the connected Workspace
  domain is preferred and must match the live, verified WorkOS identity; an
  administrator-managed Google email mapping supports staff who log in with
  another address. A personal sender cannot use another user's assigned mailbox
  or a reserved department mailbox. Explicit department senders take precedence.
- Staff without a matching Workspace address use the tracked reply mailbox
  when it belongs to that Workspace (Jarvis for HPS), identified by name with
  "via Compass". Other companies retain their configured system sender and
  provider chain, including when Google is not connected. Automatic personal
  sender selection matches the configured Workspace domain exactly.
- Individual and department Workspace senders use Gmail only. A rejected mailbox
  authorization or delivery must be reported; never silently substitute the
  shared sender or a fallback provider. Automated notifications retain their
  configured system sender.
- Record an Activity event once the email is sent (category `email`, an action
  like `<kind>_emailed`, and a summary naming the record and recipients).

`sendCompassEmail` is still right for mail that isn't about a record and
expects no reply: notification emails, account invitations, greeting cards,
and the project email composer, which keeps its own conversation thread. Those
callers are listed in the standard test. Adding a new one means adding it to
that list on purpose, with a reason.

## Replies

- The inbox sync routes replies by token. `announceTrackedRecordReply`
  (`src/lib/email/tracked-record-replies.ts`) logs the reply in Activity and
  notifies the sender plus project staff. A new kind only needs entries in
  `tracked-record-email.ts`.
- Show replies where the record is: an **Email replies** section on the
  record (`RecordEmailReplies`), or the job's interaction history for job
  emails. Replies stay internal until staff act on them.
- A client's reply counts as client contact (interaction history, follow-up
  aging); replies from anyone else do not.

## Notifications

- Name event types with the prefix of the Settings switch they belong to
  (`rfi.`, `po.`, `owner_update.`, `schedule.`), so each person's preferences
  apply. Other prefixes are always on, subject to each person's in-app, email,
  and push settings.
- Notify the person who started the workflow and the project's staff. Don't
  notify someone about their own action.
- Events from outside Compass (email replies, webhooks) use
  `notifyProjectStaffOfOutsideEvent`. Events from a signed-in user use
  `createNotificationEvent`.
- Only notify when the state actually changes, so webhook retries and repeat
  syncs stay quiet.

## Activity log

Record an Activity event (`recordActivityEvent`) for every send, every reply
or outside response received, and every outside status change (a signature,
a vendor portal response, a publish or recall). Activity logging never makes
the underlying action fail.

## Compose dialog

- To and Cc use `EmailRecipientPicker`, filled with the project's contacts
  (`projectEmailRecipientOptions` or `buildProjectEmailRecipientOptions`),
  with the likely recipient recommended first. Never use a free-text address
  field.
- The subject is prefilled and editable. The record's own content (the RFI
  question, the RFQ scope, the PO) is always included, and the user's note
  goes above it.
- Say where replies will go ("Replies come back to this RFQ in Compass and to
  you").
- Disable Send until there is a recipient. Show a success toast that says
  what happened, then refresh.
- Update the help guide for the workflow in the same PR.
