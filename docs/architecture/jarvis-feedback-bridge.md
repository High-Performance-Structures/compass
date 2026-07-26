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

Data flow
---

```text
Compass conversation / feedback widget
                 |
                 v
       D1 feedback desk + outbox
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

The reference poller is
`scripts/jarvis-agent-poller.py`. The user-service template is
`ops/systemd/compass-jarvis-agent-poller.service`; install the script under
`~/.local/lib/compass/`, install the unit under
`~/.config/systemd/user/`, then enable it only after the filtered production
endpoint is deployed.

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
priority, and GitHub issue URL. Compass updates the durable Feedback Desk
record and creates:

- an in-app notification for the matching authenticated requester;
- preference-aware email/push delivery for information-needed, testing, and
  deployment milestones; and
- a `feedback.status_changed` outbound bridge event so Telegram, email, and
  originating Compass-thread adapters can reply through the source channel.

The notification links to `/dashboard/requests`, where authenticated users
see only requests matching their organization and account email. GitHub
remains the developer record and is not required for staff to follow a
request.

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

1. Apply migration `0065_jarvis_feedback_bridge.sql`.
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

The bundled bridge helper includes a `configure` command for step 5. It
generates the HMAC key on the private runtime and returns only RSA-encrypted
ciphertext for one-time transfer into Cloudflare. The raw shared key must not
be printed, logged, or committed.
