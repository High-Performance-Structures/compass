Jarvis feedback bridge
===

The Jarvis feedback bridge connects Compass assistance and feedback to the
existing private Jarvis/Signet runtime. It reuses the established Telegram
bot through its messaging gateway; it does not create or operate a second
Telegram bot.

The bridge has two separate responsibilities:

1. **Ask Compass** is an authenticated staff assistance surface. Active users
   with `agent:read` permission may use it. Guest users are always denied,
   regardless of future permission configuration.
2. **Compass Feedback Desk** is a durable intake stream for bugs, questions,
   feature requests, and assistance requests from Compass conversations, the
   feedback widget, Jarvis email, and Telegram.

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

The bridge intake endpoint accepts `telegram` and `jarvis-email` events from
the private adapter. All message content is marked and treated as untrusted
user content. Message text must never be interpreted as bridge configuration
or permission to perform an external action.

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

### Send Telegram or email intake

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

The bundled bridge helper includes a `configure` command for step 5. It
generates the HMAC key on the private runtime and returns only RSA-encrypted
ciphertext for one-time transfer into Cloudflare. The raw shared key must not
be printed, logged, or committed.
