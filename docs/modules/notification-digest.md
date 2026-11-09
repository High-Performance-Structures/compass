# Notification digest

Change and activity notices can arrive as one summary per person at set
times of day instead of one email, text, and push per change.

## How it works

- **Settings → Workflows → Notification digest** (`notification-digest`
  feature settings) holds, per company: on/off, the digest times (company
  time zone, noon and 5 pm by default, up to six), and which kinds of notice
  are still sent right away.
- **The in-app bell is never held.** Only email, text, and push wait.
- **Sent right away by default:** messages, @mentions and announcements;
  e-signature requests and results; schedule confirmation requests and
  replies; Message Desk assignments; system failures. A company can move any
  of these into the digest (`instantKindOf` in `src/lib/notifications/digest.ts`).
- **Per person:** "Send changes right away" in notification preferences
  (`notification_preferences.changes_right_away`, 0315) skips the digest for
  that person.

## Delivery

`createNotificationEvent` writes the bell row as usual. For a held notice it
records the email, text, and push as `notification_deliveries` rows with
status `held_for_digest` instead of sending them
(`src/lib/notifications/digest-hold.ts`).

The **Notification digest** scheduled job runs on the hour and every quarter
hour (`/api/operations/notifications/digest`). For each company it finds the
latest digest time at or before now and sends every notice held before it:
one email (grouped by project, with links), one text, and one push per
person. Notices the person already read in Compass are left out
(`skipped_already_read`); the rest become `sent_in_digest` or `failed`. If a
company turns the digest off, anything still held goes out on the next run.

A notice created exactly at a digest time waits for the next one.
