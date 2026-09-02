Greeting cards
===

Compass can prepare and fulfill mailed handwritten cards and Compass-created
e-cards for clients, subcontractors, vendors, employees, and other business
relationships. The general workspace is `/dashboard/cards`; the original
CHERISH review stream retains its recognition-linked fulfillment history.

access and approval
---

- Every active employee in an internal organization can prepare a request,
  including office and field roles using Full Compass.
- The outside `developer` role and all client, subcontractor, supplier, and
  guest accounts are excluded.
- A preparer sees only their own active requests. Executive Admin sees the
  organization-wide queue.
- Preparing a request is non-billable. Executive Admin must first approve the
  content and recipient, then use a separate confirmed release action.
- Pending and rejected requests can be removed from the active queue. Removal
  is soft deletion with actor and timestamp fields so the audit record remains
  recoverable. Released provider orders are never deleted from Compass.

provider direction
---

| Delivery | Provider | Cost |
|---|---|---|
| Physical mail | Handwrytten | Card, postage, tax, and account terms |
| Digital e-card | Compass email | No per-card Compass fee; normal configured email-provider terms apply |
| Optional digital gift | Giftbit Direct Links | Gift face value; no Giftbit API, platform, subscription, or minimum fee. Funding method fees may apply. |

Compass owns the e-card content, recipient page, and delivery email. Giftbit is
contacted only when an approved e-card includes a gift. The Direct Links API
returns a private reward URL, letting the recipient choose from eligible US
brands without replacing the HPS card experience.

The integration defaults to Giftbit Testbed, which uses virtual funds. Moving
to production requires a separate production account, Giftbit's KYB/use-case
approval, a production API token, explicit `GIFTBIT_ENVIRONMENT=production`,
and a funded account. See Giftbit's
[developer hub](https://www.giftbit.com/developers/) and
[API documentation](https://www.giftbit.com/api-documentation).

physical-card workflow
---

1. An employee chooses the recipient, Handwrytten card, occasion, message,
   closing, and verified US mailing address.
2. Compass stores the request as `pending_approval`. No provider order exists.
3. Executive Admin rejects it with a correction note or marks it `approved`.
4. Executive Admin confirms **Release for mailing**. Compass atomically claims
   the request as `submitting` before contacting Handwrytten.
5. A confirmed provider order becomes `submitted`. A definitive rejection
   returns to `approved`; an ambiguous outcome becomes `needs_attention` so a
   duplicate billable mailing cannot be created.
6. A submitted order can be cancelled while Handwrytten permits it.

digital-card workflow
---

1. An employee chooses an HPS e-card design, recipient email, message, closing,
   and optional gift amount from $5 through $500. Saved Compass contacts fill
   the email when one is available.
2. Compass stores the private card and a high-entropy public token as
   `pending_approval`. It does not email the recipient or contact Giftbit.
3. Executive Admin approves the exact content, email, and gift amount.
4. **Send e-card** atomically claims the request. If a gift is included,
   Compass creates one idempotent Giftbit Direct Link using the request ID.
5. Compass sends the recipient a private `/ecard/{token}` link through the
   existing Google Workspace email delivery, with Resend fallback. The Giftbit
   claim URL stays on the private card page instead of appearing in the email.
6. Cancelling disables the Compass card link. If a Giftbit reward is included,
   Compass cancels it and restores funds only while it remains unredeemed. The
   already-delivered email cannot be recalled.

Giftbit creation retries reuse the same client-provided order ID, which Giftbit
documents as idempotent. An unconfirmed email outcome moves to
`needs_attention`; staff should check the recipient inbox and can cancel the
private card and any unredeemed reward from the approval queue.
`GIFTBIT_ORDERING_ENABLED=false` is the emergency stop for both testbed and
production: it blocks new reward orders without preventing cancellation of an
existing reward.

configuration
---

Set these only in server-side local or Cloudflare Worker configuration:

| Variable | Purpose |
|---|---|
| `HANDWRYTTEN_API_KEY` | Handwrytten API credential. Treat as a secret. |
| `HANDWRYTTEN_SENDER_BUSINESS_NAME` | Return-address business name. |
| `HANDWRYTTEN_SENDER_ADDRESS1` | Return street address or PO Box. |
| `HANDWRYTTEN_SENDER_CITY` | Return city. |
| `HANDWRYTTEN_SENDER_STATE` | Two-letter return state. |
| `HANDWRYTTEN_SENDER_POSTAL_CODE` | Return ZIP code. |
| `HANDWRYTTEN_SENDER_FIRST_NAME` | Optional sender first name. |
| `HANDWRYTTEN_SENDER_LAST_NAME` | Optional sender last name. |
| `HANDWRYTTEN_SENDER_ADDRESS2` | Optional return unit or suite. |
| `HANDWRYTTEN_FONT_LABEL` | Optional font; defaults to `Casual David`. |
| `COMPASS_PUBLIC_BASE_URL` | Public HTTPS origin used in e-card emails. |
| `GIFTBIT_ENVIRONMENT` | `testbed` by default; `production` must be explicit. |
| `GIFTBIT_ORDERING_ENABLED` | Must be `true` for any testbed or production reward order; set `false` to halt new orders. |
| `GIFTBIT_API_KEY` | Environment-specific Giftbit bearer token. Treat as a secret. |

Compass email also requires its existing Google Workspace service-account
configuration or `RESEND_API_KEY` fallback. Apply
`drizzle/0145_greeting_card_approval_queue.sql` followed by
`drizzle/0146_greeting_card_ecards_giftbit.sql`. Credentials, mailing
addresses, recipient email addresses, public tokens, and Giftbit claim URLs
must never be logged or exposed in client-side environment variables.
