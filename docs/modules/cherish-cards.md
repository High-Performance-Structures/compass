Greeting cards
===

Compass can prepare and fulfill physical greeting cards for clients,
subcontractors, vendors, employees, and other business relationships. The
general workspace is `/dashboard/cards`; the original CHERISH review stream
retains its recognition-linked fulfillment history.

access and approval
---

- Every active employee in an internal organization can prepare a request,
  including office and field roles.
- The outside `developer` role and all client, subcontractor, supplier, and
  guest accounts are excluded.
- A preparer sees only their own active requests. Executive Admin sees the
  organization-wide queue.
- Preparing a request is non-billable. Executive Admin must first approve the
  content and address, then use a separate confirmed **Release for mailing**
  action to create the provider order.
- Pending and rejected requests can be removed from the active queue. Removal
  is soft deletion with actor and timestamp fields so the audit record remains
  recoverable. Provider orders are never deleted from Compass.

provider direction
---

| Delivery | Provider | Status | Gift support |
|---|---|---|---|
| Physical mail | Handwrytten | Implemented | Intentionally disabled in the current release |
| Digital e-card | CardSnacks | Planned; API access and commercial terms must be confirmed | Optional digital gift card |

Handwrytten writes, addresses, stamps, and physically mails the card. Its cost
is separate from any gift value and can include the card, postage, tax, and the
provider plan or credit terms in effect for the account.

CardSnacks is the preferred digital path because it supports delivery by email
or text and offers e-gift cards. Its self-service business subscription does not
document that API access is included; API integration is presented as a
sales-assisted product. Do not expose a CardSnacks option in Compass until the
API agreement, authentication, sandbox behavior, gift-card fees, refund rules,
and webhook or status-reconciliation contract are documented and tested.

physical-card workflow
---

1. An employee chooses the recipient type, current Handwrytten card, occasion,
   message, closing, and verified US mailing address.
2. Compass stores the request as `pending_approval`. No provider order exists.
3. Executive Admin either rejects the request with a correction note or marks
   it `approved`.
4. Executive Admin reviews the approved content again and confirms release.
   Compass atomically claims the request as `submitting` before contacting
   Handwrytten.
5. A confirmed provider order becomes `submitted`. A definitive rejection
   returns to `approved` and can be released again. An ambiguous network or
   provider failure becomes `needs_attention` and must be reconciled in
   Handwrytten to prevent duplicate billable mail.
6. A submitted order can be cancelled while Handwrytten still permits it.

The `greeting_card_requests` table records requester, approver, rejector,
releaser, deletion actor, provider order, status timestamps, message, and the
mailing address snapshot used for fulfillment.

configuration
---

Set the following only in server-side local or Cloudflare Worker configuration:

| Variable | Purpose |
|---|---|
| `HANDWRYTTEN_API_KEY` | Handwrytten API credential. Treat as a secret. |
| `HANDWRYTTEN_SENDER_BUSINESS_NAME` | Return-address business name. |
| `HANDWRYTTEN_SENDER_ADDRESS1` | Return street address. |
| `HANDWRYTTEN_SENDER_CITY` | Return city. |
| `HANDWRYTTEN_SENDER_STATE` | Two-letter return state. |
| `HANDWRYTTEN_SENDER_POSTAL_CODE` | Return ZIP code. |
| `HANDWRYTTEN_SENDER_FIRST_NAME` | Optional sender first name. |
| `HANDWRYTTEN_SENDER_LAST_NAME` | Optional sender last name. |
| `HANDWRYTTEN_SENDER_ADDRESS2` | Optional return unit or suite. |
| `HANDWRYTTEN_FONT_LABEL` | Optional Handwrytten font label; defaults to `Casual David`. |

The API key alone is sufficient to prepare a request and browse the provider
catalog. The complete sender return address is required only at release time.
Apply `drizzle/0145_greeting_card_approval_queue.sql` before enabling the
general workspace. Credentials and recipient addresses never belong in
client-side environment variables or logs.
