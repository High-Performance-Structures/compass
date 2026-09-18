# Square production authentication monitoring

## Contract

The private invoice bridge and Compass payment reconciliation use separate
production credentials. Both must be checked; a healthy credential in one
location does not establish health in the other.

- The private `square_auth_monitor.py` systemd timer runs every minute, with
  up to five seconds of jitter. It performs only `GET /v2/locations`, even
  when no Sage invoice is ready, and verifies unique active HPS, ORC, and
  Nu-Tech locations. It does not connect to Sage.
- Compass's existing one-minute Cloudflare cron independently checks
  `SQUARE_PRODUCTION_ACCESS_TOKEN` with the same read-only endpoint and
  location validation.
- The private monitor sends a bounded, HMAC-authenticated observation to
  `/api/integrations/square/auth-health`. The organization and service identity
  are fixed server-side. Stale observations and arbitrary diagnostic text are
  rejected. Newer observations cannot be replaced by delayed/replayed reports.
- Operational state is retained in the existing `feedback_service_health`
  table under `square-invoice-auth` and `square-compass-auth`.

## Notifications and recovery

Active administrators in the configured Square organization receive in-app
notifications under the Compass bell, respecting their in-app preference.
The notices link to Automations and distinguish credential rejection (401/403),
missing credentials, location/account mismatch, and API availability problems.
The notification identifies which credential store needs attention.

If the private monitor stops reporting for five minutes, the Cloudflare check
creates an offline notice. This also covers a stopped timer, an offline host,
secret-broker failure, or rejected Compass reporting credentials. A five-minute
commissioning window precedes the first offline notice after installation.

Incident IDs are stable throughout an unchanged failure. Event and recipient
rows commit atomically with deterministic IDs, so retries and overlapping
cron/report requests cannot duplicate notifications. A successful read creates
one recovery notice per outstanding incident and dismisses the old failure
notice. A later outage can notify again. Notification-write failures are retried
by subsequent checks instead of being marked delivered in a local file.

The monitor does not rotate tokens, publish invoices, approve payments, or
post receipts. Recovery verifies API access, not completion of outstanding
financial work. Billing remains gated by Sage's exact `SQUARE:READY` value.
A Locations check does not prove every write permission or webhook delivery;
invoice/payment execution errors remain separate workflow exceptions.

## Installation

Deploy the Compass route and cron change first. Install `square_auth_monitor.py`
alongside `wait_for_signet_secret_exec.py` on the private bridge. Install the
provided `compass-square-auth-monitor.service` and `.timer` user units, reload
systemd, and enable/start the timer. Signet injects
`HPS_SQUARE_PRODUCTION_ACCESS_TOKEN` and `JARVIS_BRIDGE_SECONDARY_SECRET` into
the subprocess; neither belongs in the unit or repository. The secondary key
must be an accepted Compass bridge key. Failed Signet execution must propagate
as a failed systemd run rather than being treated as a successful queued job.

Verify both service rows report healthy and their heartbeat timestamps advance.
Use mocks for rejection, timeout, and recovery tests; never corrupt the live
credential merely to exercise an alert. The invoice poller and its timer are
unchanged and should continue running independently.

## Current payment-notification handoff

The separate Square payment workflow currently notifies active administrators,
not the employee who originally entered the Sage invoice. Its project-scoped
notice opens Financials with the Square receipt selected. When automated Sage
payment writes are disabled, the manual-receipt notice instructs staff to post
the received payment in Sage Electronic Receipts; it does not request a second
payment authorization. An error is an exception requiring review, not a signal
to charge the customer again.

A reliable Sage invoice-creator-to-Compass-user mapping is required before
creator-specific alerts can be promised. The existing imported invoice's
service-user `created_by` value must not be mistaken for the original Sage
employee. Creator alert routing is not implemented by the auth monitor.
