# Google Calendar Sync

Status: managed calendar sync and project calendar publishing implemented

Owner: Compass product and engineering

Tracking branch: `martine/google-calendar-managed-sync`

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

## Implemented Slice

The current slice includes the OAuth foundation plus managed import and
write-through behavior:

- per-user Google connection records with encrypted refresh credentials;
- selected Google calendars and incremental sync/watch metadata;
- stable mappings between Compass records and Google event IDs;
- typed OAuth configuration and response parsing;
- explicit privacy projection and conflict-decision helpers;
- event type, visibility, and meeting-link fields in the existing scheduler;
- project-access-aware event projection that hides or reduces private details;
- calendar discovery and per-calendar import/export configuration;
- personal-calendar caches that remain owner-scoped and project other users'
  events as `Busy`;
- a Work Calendar people filter for the current user, one internal user, or all
  connected internal users;
- organization calendars (such as ORC Master) that import into the shared Work
  Calendar and carry explicit detail/create/edit/delete permissions;
- an event destination selector that can publish Compass events to a writable
  personal or organization Google calendar;
- linked create/update/delete calls so Google-backed Work Calendar events stay
  synchronized when the calendar policy permits the action;
- organization-owned, on-demand project Google calendars that automatically
  receive project-scoped Compass events;
- office-staff enable/pause/access-sync controls, administrator delete controls,
  and per-user “Add to my Google Calendar” subscriptions;
- project-level event sync that preserves the Compass project scope for events
  created or edited from the shared Google calendar;
- optional Google Meet conference creation for Compass events published to a
  writable Google calendar, with the returned Meet URL stored in Compass;
- external Meet launch actions that open Google Meet in a separate tab or
  native app rather than embedding the call in Compass;
- Google ACL roles derived from Compass access: office staff can edit events
  without managing sharing, while field and external project members are readers;
- an integration status surface that remains safe when Google OAuth is not configured;
- tests for privacy, idempotency, and two-way conflict behavior.

The production D1 migration and OAuth secret configuration remain deployment
approval points.

## Google Cloud Configuration

Create a Google Cloud OAuth web client for the production Compass hostname and
the approved local development callback. Configure:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`

The encryption key must be independent from the OAuth client secret. Store all
production values as Cloudflare secrets. Do not commit them to source control.

The consent request is intentionally limited to:

- OpenID email identity;
- read/write access to the user's subscribed calendar list;
- event read/write access;
- creation and management of calendars created by Compass; and
- ACL management for calendars owned by the connected organization account.

Existing connections created before project calendar publishing must reconnect
once to grant the added Calendar List, app-created calendar, and ACL scopes.

Google Tasks permissions are added only when the Tasks phase is implemented.

## Privacy Rules

- A project-scoped event is hidden from users without access to that project.
- Event owners and participants see full details.
- Participant-only and busy events appear as `Busy` to other authorized staff.
- Personal Google events always show full details only to their owner. Other
  internal users receive a `Busy` projection without description, location,
  meeting URL, or Google link.
- Organization calendar visibility is configured independently as details or
  busy-only.
- Managed project calendars preserve project access when their events are
  synchronized into the Work Calendar; they are not treated as general
  organization events.
- Private Compass events are hidden from nonparticipants.
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

The current implementation uses a bounded manual sync window (90 days in the
past through two years in the future). Incremental sync tokens and push watches
remain follow-up work.

## Follow-up Slices

1. Scheduled event/access reconciliation, retries, incremental sync tokens,
   renewable watches, and a
   conflict-resolution UI.
2. Remaining robust event fields: recurrence exceptions, external attendees,
   reminders, attachments, and related Compass records.
3. Google Tasks synchronization after calendar behavior is stable.
