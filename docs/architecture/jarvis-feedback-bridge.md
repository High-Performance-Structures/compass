Jarvis feedback bridge
===

The Jarvis feedback bridge connects Compass assistance and feedback to the
existing private Jarvis/Signet runtime. It reuses the established Telegram
bot through its messaging gateway; it does not create or operate a second
Telegram bot.

The bridge has three separate responsibilities:

1. **Ask Jarvis** is an authenticated staff assistance surface. Active users
   with `agent:read` permission may use it. When
   `JARVIS_AGENT_BRIDGE_ENABLED=true`, basic chat requests are relayed to the
   private Hermes runtime instead of a provider API called directly by the
   Cloudflare Worker. Guest users are always denied, regardless of future
   permission configuration.
2. **Compass Feedback Desk** is a durable intake stream for bugs, questions,
   feature requests, and assistance requests from Compass conversations, the
   feedback widget, Jarvis email, and Telegram.
3. **Hermes response relay** returns the completed `agent.prompt` result to
   the originating authenticated Compass request using the existing agent SSE
   protocol.

Field access and offline replay
---

Active field-role users have `agent:read` permission and may open Ask Jarvis
from the Field Desk on mobile or desktop. Guest and client accounts remain
denied in both the UI and every agent API route.

When a field user submits a text prompt while `navigator.onLine` is false,
Compass stores it in the scoped field outbox rather than attempting the
bridge request. On reconnection, the normal authenticated `/api/agent`
request is made with the current organization/user session and the existing
Signet isolation headers. A queued prompt is deleted locally only after the
SSE response completes successfully. CHERISH submissions use the same
outbox lifecycle but replay through the existing authenticated server action.

The outbox is not a media transport. Photo, video, and document handoff needs
a separately reviewed attachment contract so an offline file cannot be
replayed under the wrong user, organization, project, or conversion target.

Data flow
---

```text
Compass conversation / feedback widget
                 |
                 v
       D1 feedback desk + private provenance/outbox
                 |
          signed pull / ack
                 |
                 v
       private Signet/Jarvis runtime
          |                   |
  existing Telegram bot   Jarvis mailbox
          |                   |
          +---- signed intake-+
                 |
          signed reply callback
                 |
                 v
      originating Compass thread
```

Ask Jarvis uses the same outbound queue without making Signet publicly
reachable:

```text
authenticated Compass Ask Jarvis request
                 |
         D1 agent.prompt event
                 |
          signed private pull
                 |
                 v
  local-only Hermes API (Compass skill, no tools)
                 |
        signed result acknowledgement
                 |
                 v
     Compass agent SSE response
```

The Compass-facing Hermes API binds to loopback only. Its
`platform_toolsets.api_server` configuration must be an explicit empty list
for the basic-assistance rollout. Staff prompts therefore cannot invoke
terminal, filesystem, messaging, or other action tools through this path.
The poller loads the Compass Feedback Desk skill as response and
classification guidance. When Jarvis recognizes an explicit report, the
poller submits it through the same signed intake endpoint used by the
Telegram/email adapter. The model never receives the bridge secret or a tool
capable of submitting the report itself.

Compass remains deployable on Cloudflare without direct access to a private
tailnet address. The private adapter polls Compass over HTTPS, so no private
Signet service needs to be exposed publicly. D1 stores events until the
adapter acknowledges them. Claims that are not acknowledged within five
minutes become eligible for delivery again.

Sources and routing
---

The following Compass activity creates feedback desk items:

- a message in a channel named `compass-feedback`;
- an `agent` mention from a user allowed to use Ask Compass;
- a feedback widget submission.

Authenticated Ask Jarvis prompts create `agent.prompt` bridge events. These
are not feedback desk items and do not post into a conversation channel.

The bridge intake endpoint accepts `telegram`, `jarvis-email`, and
`ask-jarvis` events from the private adapter. All message content is marked
and treated as untrusted user content. Message text must never be interpreted
as bridge configuration or permission to perform an external action.

`jarvis-email` is the existing Jarvis mailbox adapter for
`jarvis@hps-colorado.com`; it is not a separate public email integration.
Compass stores the sender address and adapter routing data only in the
Feedback Desk's protected record and bridge payloads.

GitHub issue and privacy boundary
---

New Feedback Desk submissions are mirrored to a GitHub issue and added to the
`Compass Development & Feedback` GitHub Project. Recovered historical requests
without an existing link remain in an administrative preview until an
administrator either maps existing work or explicitly approves creation of a
new issue. GitHub is deliberately a
minimal engineering tracker, not the system of record for a request. Its
title and body contain only the request kind and an opaque `CFD-<UUID>`
correlation reference. They never contain the submitted title or message,
reporter name, email address, Telegram identifier, source event identifier,
page URL, user agent, or bridge metadata.

The corresponding request content, source provenance, requester identity,
and reply target stay in Compass D1 and the signed private bridge. Configure
`GITHUB_FEEDBACK_PROJECT_ID` with the node ID of the `Compass Development &
Feedback` Project for deterministic project insertion. When it is absent,
Compass attempts a title lookup among the repository organization's projects and logs a
configuration error rather than exporting private data.

The prior feedback-widget issue formatter included the optional reporter name
and email in GitHub issue bodies. It has been removed: new widget submissions
now use the same sanitized export as Telegram, Jarvis email, and Compass
conversation feedback. Scheduled reconciliation rewrites linked legacy widget
issues to the private-correlation format and records `privacy_scrubbed_at`; it
never copies private request content back to GitHub.

Guest policy
---

Guest users cannot use Ask Compass:

- the header assistant button is not rendered;
- Ask Compass actions are omitted from desktop and mobile search;
- the assistant panel and mobile launcher are not rendered;
- `/api/agent`, `/api/agent/render`, and `/api/agent/action` return HTTP 403.

This is enforced by `canUseAskCompass()`, which contains an explicit guest
denial in addition to the normal `agent:read` permission check. Guest users
may still submit ordinary feedback unless a separate product decision
restricts the feedback widget.

Authentication
---

Every adapter request is signed with HMAC-SHA256. Configure the same
`JARVIS_BRIDGE_SECRET` as a secret in Compass and the private adapter.

Temporary dual-secret rollover
---

Use `JARVIS_BRIDGE_SECONDARY_SECRET` only for a time-bounded, approved
operator rollover. It is an additional Cloudflare secret binding, not a
replacement for `JARVIS_BRIDGE_SECRET`; the existing primary-signed poller
and notifier continue to work unchanged. The shared verifier checks the
primary and secondary candidates with constant-time comparisons, and only the
existing Jarvis integration and signed maintenance endpoints use that verifier.

1. Generate a new random value independently of the primary, for example with
   `openssl rand -hex 32`. Do not print it, place it in a repository or local
   environment file, or include it in logs, tickets, screenshots, or command
   history.
2. Deploy the verifier change while the secondary binding is absent. This
   preserves the existing primary-only behavior during the code rollout.
3. Provision the generated value as the production
   `JARVIS_BRIDGE_SECONDARY_SECRET` secret and, separately, in the approved
   operator credential store. The operator process may use the secondary value
   as its local `JARVIS_BRIDGE_SECRET`; do not replace the primary value used
   by the existing poller or notifier.
4. Exercise only the required existing Jarvis endpoint(s), using the normal
   timestamp, raw-body, path, idempotency, and authorization contracts. Verify
   the primary path still succeeds and the secondary path succeeds before any
   operational use. Do not add a new endpoint or broaden the route scope.
5. When the operator task is complete, stop using the secondary credential,
   remove `JARVIS_BRIDGE_SECONDARY_SECRET` from the production Worker, and
   revoke/delete the operator-side copy. Confirm that a request signed only
   with the retired value receives HTTP 401, while the primary poller and
   notifier still succeed.

If the temporary credential may have been exposed, treat it as compromised:
remove it immediately and generate a new primary/secondary pair according to
the approved incident procedure. Do not rely on application logs to identify
which secret signed a request; the bridge deliberately does not log secret
material or secret identifiers.

Set `JARVIS_AGENT_BRIDGE_ENABLED=true` in Compass only after the private
poller and loopback-only Hermes API are healthy. Setting it to `false`
immediately restores the direct provider route.

Required headers:

```text
X-Compass-Timestamp: <Unix timestamp in seconds>
X-Compass-Signature: sha256=<lowercase hex HMAC>
```

The signed value is:

```text
<timestamp>.<uppercase method>.<path and query>.<raw request body>
```

Compass rejects signatures more than five minutes old, compares signatures
in constant time, and limits request bodies to 64 KiB. The adapter must use a
unique idempotency key for every source event and reply.

Endpoints
---

### Pull Compass events

```text
GET /api/integrations/jarvis/events?limit=20
```

The request has an empty body. The response contains up to 50 claimed events.
Each event includes its ID, type, source, delivery attempt, payload, and
creation time.

The basic Ask Jarvis poller uses
`?limit=1&eventType=agent.prompt` so it cannot claim unrelated Feedback Desk
events or hold multiple prompts while Hermes handles them sequentially.

The private delivery worker uses
`?eventType=feedback.delivery_requested` and acknowledges each graph handoff
through the same signed event acknowledgement endpoint. A retryable failure
must include `retryAfterSeconds`; a terminal failure remains visible instead of
being treated as a completed delivery.

The reference poller is
`scripts/jarvis-agent-poller.py`. The user-service template is
`ops/systemd/compass-jarvis-agent-poller.service`; install the script under
`~/.local/lib/compass/`, install the unit under
`~/.config/systemd/user/`, then enable it only after the filtered production
endpoint is deployed.

Requester lifecycle delivery uses the separate deterministic notifier at
`scripts/jarvis-feedback-notifier.py` and the
`ops/systemd/compass-jarvis-feedback-notifier.service` template. It pulls only
`feedback.status_changed` events, routes Telegram and Jarvis-mail updates
through Hermes's existing send adapters, posts Compass-conversation replies
through the signed reply endpoint, and acknowledges Ask Jarvis/widget events
after their Compass-native receipt or notification is available. Its local
delivery ledger prevents a service restart from sending the same external
update twice before acknowledgement. The notifier service runs with Hermes's
virtual-environment Python so those send adapters use the same dependencies as
the Hermes gateway.

Confirmed bugs that an administrator moves into `triaged` also enqueue one
`feedback.delivery_requested` event. The event is the supported handoff to the
private Hermes/Kanban runtime: it contains only the Feedback Desk item's opaque
ID, the `CFD-<UUID>` reference, and the fixed `bug` kind. It never contains the
request title, description, reporter, source ID, channel, thread, or metadata.
The event's idempotency key is `feedback-delivery-graph:<item-id>`, so a
maintenance retry or repeated status callback cannot create a second graph.
The private runtime creates the implementation, independent-review, and
release-steward tasks through its normal Kanban tools, then attaches all three
task IDs to the protected Feedback Desk record with a signed callback. A
successful graph attachment leaves the request `triaged`. Compass applies the
same fail-closed evidence predicates to administrator updates, signed Jarvis
callbacks, and GitHub Project synchronization: `planned` and `in_progress`
require a durable graph with all three task IDs, while `testing` and `deployed`
also require the linked pull-request evidence. A `feedback.delivery_requested`
event cannot be acknowledged as completed until that complete graph attachment
is visible in D1; an incomplete attachment leaves the event `pending` with a
retry time. A retryable pull failure returns the event to `pending`, while a
terminal failure remains visible in the protected operations health and
Feedback Desk records. Features never enqueue this event and remain blocked by
the persisted leadership priority decision.

Both private relay services post a signed heartbeat to
`POST /api/integrations/jarvis/health` at least once per minute. The protected
Feedback Desk shows heartbeat age, last failure, and pending/processing/failed
bridge counts. A missing heartbeat is an operational failure even when the
process manager still reports the service as running.

### Acknowledge an event

```text
POST /api/integrations/jarvis/events/<event-id>/ack
```

Completed:

```json
{
  "status": "completed",
  "result": {
    "classification": "question"
  }
}
```

Retryable failure:

```json
{
  "status": "failed",
  "error": "Temporary provider failure",
  "retryAfterSeconds": 300
}
```

A failed acknowledgement without `retryAfterSeconds` is terminal and remains
visible for investigation.

For `agent.prompt`, a successful acknowledgement stores:

```json
{
  "status": "completed",
  "result": {
    "content": "The answer returned by Hermes.",
    "model": "the resolved Hermes model"
  }
}
```

Compass waits up to 90 seconds for this result. A browser retry reuses the
same idempotent event when its session and message history are unchanged.

### Search Compass for an Ask Jarvis event

```text
GET /api/integrations/jarvis/events/<event-id>/search
```

The signed, read-only route derives the organization, user role, current
project, and latest question from the stored `agent.prompt`; callers cannot
override that scope. It rejects guest and client roles, returns bounded Daily
Log, Owner Update, RFI, and project summaries, and includes canonical live
Compass URLs. The private poller injects these results as untrusted reference
data before calling Hermes. Search failure does not prevent basic chat from
answering.

### Send Telegram, email, or Ask Jarvis intake

```text
POST /api/integrations/jarvis/events
```

```json
{
  "source": "telegram",
  "sourceEventId": "telegram-update-123",
  "eventType": "feedback.reported",
  "kind": "bug",
  "title": "Photo upload failed",
  "content": "The upload button returned an error.",
  "actor": {
    "name": "Staff member",
    "externalId": "telegram-user-456"
  },
  "metadata": {
    "conversationId": "telegram-chat-789"
  }
}
```

The adapter must not send a Telegram token or message-provider credential in
the payload or metadata.

### Update a Feedback Desk request

```text
POST /api/integrations/jarvis/feedback/<feedback-desk-item-id>/status
```

The signed lifecycle endpoint accepts an idempotency key, one of the visible
request states (`new`, `triaged`, `needs_info`, `planned`, `in_progress`,
`testing`, `deployed`, or `closed`), an optional staff-facing message,
priority, GitHub issue URL, and optional `draftPullRequestUrl`. Compass updates the durable Feedback Desk
record and creates:

- an in-app notification for the matching authenticated requester;
- preference-aware email/push delivery for information-needed, testing, and
  deployment milestones; and
- a `feedback.status_changed` outbound bridge event so Telegram, email, and
  originating Compass-thread adapters can reply through the source channel.

Compass creates a neutral receipt event when the item is first recorded.
Subsequent triage, planned, and in-progress events use the same source-aware
payload. A new `draftPullRequestUrl` sets `notificationKind` to
`draft_pull_request_opened`; the bridge delivers the human-readable pull
request link only to the originating private channel. Compass-thread replies
are posted through the existing signed reply endpoint, which derives the
stored original thread instead of trusting a callback-supplied destination.
Compass suppresses repeated callbacks that leave both the lifecycle status and
draft pull request unchanged. Requesters receive only receipt, a meaningful
status transition (triage, information needed, planned, implementation,
testing, deployment, or closure), or a newly opened/materially updated draft
pull request. A private delivery worker may attach a complete
implementation/review/release graph in the same signed callback using
`deliveryGraph` while leaving the request in `triaged`; incomplete graph
attachments and lifecycle advancement in that callback are rejected.
The event's `source` is always the original source (`telegram`,
`jarvis-email`, or `compass-conversation`), never a generic fallback route:
the adapter must send Telegram updates only through Telegram, Jarvis mailbox
updates only through email, and Compass updates only to the stored Compass
thread/request. Cross-channel delivery requires a separate product decision.

The notification links to `/dashboard/requests`, where authenticated users
see only requests matching their organization and account email. Users in the
`developer`, `admin`, and `secondary_admin` roles also receive a protected
My requests / All requests filter for organization-wide investigation. Only
administrators can mutate the organization-wide desk at
`/dashboard/requests/manage`.

Private scheduled lifecycle operation
---

The approved private runtime helper at
`skills/compass-feedback-desk/scripts/compass_feedback_bridge.py` exposes a
single `status` operation for scheduled or explicitly authorized lifecycle
work. Install the helper under the private runtime's
`~/.local/lib/compass/` path, keep `COMPASS_BASE_URL` and
`JARVIS_BRIDGE_SECRET` in its protected environment, and invoke it with
structured arguments or a bounded JSON payload file:

```bash
python ~/.local/lib/compass/compass_feedback_bridge.py status \
  --item-id <uuid> \
  --status in_progress \
  --idempotency-key feedback-<uuid>-status-v1
```

The helper accepts only the visible lifecycle statuses, bounded requester
message and priority values, fixed HTTPS GitHub issue/PR URL schemas, and an
idempotency key. It constructs and signs only
`POST /api/integrations/jarvis/feedback/<uuid>/status`; it has no target,
path, header, command, shell, D1, or cross-channel delivery input. A retry
reuses the same idempotency key, and the compact JSON result reports only
acceptance, duplicate status, lifecycle status, notification count, and
requester-update queuing. Compass still performs all organization,
authorization, evidence, persistence, source-routing, and delivery checks.

The durable private runtime consumes approved lifecycle handoffs separately
from requester notifications. Install
`scripts/jarvis-feedback-lifecycle-executor.py` beside the constrained helper
under `~/.local/lib/compass/` and use the
`ops/systemd/compass-jarvis-feedback-lifecycle-executor.service` user-unit
template. The executor polls only the signed
`feedback.lifecycle_requested` event filter, validates the same bounded
non-feature payload, invokes the co-installed helper, and acknowledges the
queue event only after the fixed lifecycle endpoint returns. Temporary
network/provider failures return the event to `pending` with a retry time;
malformed, feature, rejected, or otherwise terminal requests remain visible as
`failed`. A service restart may repeat a request, but it repeats the same
idempotency key and therefore receives the endpoint's duplicate result rather
than creating a second lifecycle delivery. The executor has no command,
target, header, file-transfer, D1, or browser inputs and never follows
redirects. It uses the existing primary bridge secret and does not change the
agent poller or requester notifier.

To remove the operation, stop the scheduled caller, remove its invocation and
temporary payload files, and restore the prior approved private helper. Do not
delete Feedback Desk records or bypass the lifecycle endpoint. To rotate the
credential, use the temporary dual-secret rollover above, verify both the
existing poller/notifier and the scheduled caller, then remove the retired
Worker binding and operator-side copy. Never place a secret in a payload,
ticket, command output, or log.

Scheduled reconciliation and administration
---

Cloudflare invokes the custom OpenNext worker every ten minutes. Its scheduled
handler signs a service-binding request to
`POST /api/operations/feedback/reconcile`; the endpoint accepts no public or
cookie-based authentication. Each run:

1. recovers legacy feedback-widget rows and confirmed Ask Jarvis reports;
2. repairs existing GitHub links and creates missing issues only after
   administrative approval;
3. imports GitHub Project status and closing pull-request links;
4. emits the normal private requester notifications for meaningful changes;
5. backfills SLA targets and scrubs linked legacy widget issues; and
6. stores run counts and reconciler health for the administrative dashboard.

Administrators can run the same idempotent operation with **Reconcile now**.
The GitHub link preview shows recovered requests that need review. Administrators
can map an existing issue or pull request, or approve a new issue before the next
reconciliation. They can also assign an active internal organization member,
set priority and status, and add a requester-facing explanation. SLA
targets are four hours for urgent, 24 hours for high, 72 hours for normal, and
seven days for low priority. Existing requests are measured from their
original submission time; resolved requests are never reported overdue.

### Reply to a Compass assistance request

```text
POST /api/integrations/jarvis/replies
```

```json
{
  "eventId": "outbound-event-id",
  "idempotencyKey": "reply-for-outbound-event-id-v1",
  "content": "Here is the answer for the staff member."
}
```

Compass derives the organization, channel, and original message from the
stored event. It does not trust a callback to choose an arbitrary channel.
The configured `JARVIS_SERVICE_USER_ID` must be active and must already be a
member of both the organization and target channel. A successful response is
posted as a thread reply.

Triage and response policy
---

Keep deterministic work outside a model: polling, signature verification,
deduplication, routing, state transitions, and acknowledgements.

Recommended model routing:

| Work | Model tier |
|------|------------|
| Routine classification, duplicate detection, and safe draft replies | economical general-purpose model |
| Ambiguous, sensitive, or cross-source triage | stronger reasoning model |
| Reproduction, code diagnosis, and implementation | coding model with repository access |

Initially, automation may send only a neutral receipt acknowledgement.
Substantive answers should be drafts until the response policy has been
validated with staff. Never automatically send commitments, personnel
decisions, security or privacy disclosures, legal or financial guidance, or
customer-sensitive statements.

Compass notification behavior
---

The notification bell is the default awareness surface:

- every ordinary conversation message creates a bell notification for other
  channel members whose channel notification level allows it;
- ordinary channel messages are bell-only so routine traffic does not create
  an email flood;
- direct mentions keep their existing push behavior;
- RFI participants and mapped to-do or schedule assignees receive
  preference-aware notifications; and
- Feedback Desk milestones create requester notifications.

The bell refreshes when opened, when the browser regains focus, and every 15
seconds while Compass is open. Conversation unread counts are incremented for
other channel members when a message is stored.

Rollout checklist
---

1. Apply migrations through `0093_feedback_github_creation_approval.sql`.
2. Create an active Jarvis service user in Compass.
3. Add that user to the organization and `compass-feedback` channel.
4. Configure the three `JARVIS_*` secrets/variables in Cloudflare.
5. Configure the same HMAC secret in the existing private messaging gateway.
6. Run a signed pull with no events, then submit one test feedback message.
7. Confirm redelivery after an intentionally omitted acknowledgement.
8. Confirm one signed reply appears only in the originating thread.
9. Confirm a guest sees no Ask Compass entry point and receives HTTP 403 from
   all three agent endpoints.
10. Enable Telegram and email intake one source at a time.
11. Configure Hermes's API server on `127.0.0.1` with a strong key and an
    explicit empty `platform_toolsets.api_server` list.
12. Start the private agent poller, verify one `agent.prompt` round trip, then
    enable `JARVIS_AGENT_BRIDGE_ENABLED` in Compass.
13. Start the requester lifecycle notifier, submit one test request per
    enabled source, and confirm each receipt returns only through its original
    source.
14. Deploy the custom worker and confirm the `*/10 * * * *` trigger is listed.
15. Run **Reconcile now** and confirm missing historical links appear in the
    GitHub review preview without creating issues.
16. Map known existing work, approve one genuinely untracked request, run
    **Reconcile now** again, and verify only that approved issue was created.
17. Verify the maintenance summary and three healthy service cards, and inspect
    a legacy GitHub issue to confirm that its body contains only the opaque
    `CFD-<UUID>` reference.

The bundled bridge helper includes a `configure` command for step 5. It
generates the HMAC key on the private runtime and returns only RSA-encrypted
ciphertext for one-time transfer into Cloudflare. The raw shared key must not
be printed, logged, or committed.
