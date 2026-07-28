# Google Calendar Sync

Status: foundation in progress

Owner: Compass product and engineering

Tracking branch: `martinevogel/google-calendar-sync`

## Decision

Google Calendar is the first external calendar integration. Apple-specific
calendar and reminder work is deferred. Apple users can display their Google
calendars through the Google account configured on their Apple device.

Compass keeps three operational concepts separate:

1. A schedule item is project work with duration, progress, dependencies, and
   workday rules.
2. A to-do is an assignable action with a due date and completion state.
3. A calendar event is a time-specific meeting, appointment, inspection,
   delivery, absence, or company event.

The Work Calendar presents these sources together without changing their source
of truth. H-Office remains the default project for office events and receives
priority in Office mode.

## First Reviewable Slice

The first slice establishes safe boundaries before external writes:

- per-user Google connection records with encrypted refresh credentials;
- selected Google calendars and incremental sync/watch metadata;
- stable mappings between Compass records and Google event IDs;
- typed OAuth configuration and response parsing;
- explicit privacy projection and conflict-decision helpers;
- event type, visibility, and meeting-link fields in the existing scheduler;
- project-access-aware event projection that hides or reduces private details;
- an integration status surface that remains safe when Google OAuth is not
  configured;
- tests for privacy, idempotency, and two-way conflict behavior.

External calendar writes, staff-wide enablement, and the production migration
are separate approval points.

## Google Cloud Configuration

Create a Google Cloud OAuth web client for the production Compass hostname and
the approved local development callback. Configure:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`

The encryption key must be independent from the OAuth client secret. Store all
production values as Cloudflare secrets. Do not commit them to source control.

The initial consent request is intentionally limited to:

- OpenID email identity;
- read access to the user's calendar list; and
- event read/write access.

Google Tasks permissions are added only when the Tasks phase is implemented.

## Privacy Rules

- A project-scoped event is hidden from users without access to that project.
- Event owners and participants see full details.
- Participant-only and busy events appear as `Busy` to other authorized staff.
- Private events are hidden from nonparticipants.
- Guests cannot connect a Google account or view private staff-calendar data.
- Tokens, private descriptions, and attendee contact details must never appear
  in sync logs.

## Synchronization Rules

- Compass-created event IDs are deterministic per Google account and source
  record, preventing duplicates after retries.
- Push-only mappings keep Compass authoritative.
- Pull-only mappings keep Google authoritative.
- Two-way mappings push Compass-only changes and pull Google-only changes.
- Concurrent Compass and Google edits become an explicit conflict; neither side
  is silently overwritten.
- Incremental sync tokens and renewable watch-channel metadata are stored per
  selected calendar.
- A failed webhook is only a signal to run incremental sync; webhook requests
  are not trusted as event payloads.

## Follow-up Slices

1. OAuth connect/callback/disconnect flow and calendar selection.
2. Dedicated Compass Google calendar creation and event publishing.
3. Imported Google events in the user's Work Calendar with busy projection.
4. Push notifications, incremental sync, retries, and conflict UI.
5. Remaining robust event fields: recurrence, exceptions, external attendees,
   reminders, attachments, and related Compass records.
6. Google Tasks synchronization after calendar behavior is stable.
