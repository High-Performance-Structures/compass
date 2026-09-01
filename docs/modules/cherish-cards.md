CHERISH greeting cards
===

CHERISH recognitions can be fulfilled with a greeting card from the Executive
Admin review stream. Card fulfillment is restricted to approved, team-visible
recognitions and is unavailable in demo mode.

provider direction
---

The module is designed around two complementary delivery methods:

| Delivery | Provider | Status | Gift support |
|---|---|---|---|
| Physical mail | Handwrytten | Implemented | Intentionally disabled in the first release |
| Digital e-card | CardSnacks | Planned; API access and commercial terms must be confirmed | Optional digital gift card |

Handwrytten writes, addresses, stamps, and physically mails the card. Its cost
is therefore separate from any gift value and can include the card, postage,
tax, and the provider plan or credit terms in effect for the account.

CardSnacks is the preferred digital path because it supports delivery by email
or text and offers e-gift cards. Its self-service business subscription does not
document that API access is included; API integration is presented as a
sales-assisted product. Do not expose a CardSnacks option in Compass until the
API agreement, authentication, sandbox behavior, gift-card fees, refund rules,
and webhook or status-reconciliation contract are documented and tested.

physical-card workflow
---

1. An Executive Admin opens an approved team recognition.
2. They choose a current Handwrytten card and enter the message, closing, and
   verified US mailing address.
3. Compass records a `submitting` fulfillment before contacting the provider.
4. A confirmed provider order becomes `submitted`. A definitive rejection is
   `failed` and can be corrected and retried. An ambiguous network or provider
   failure becomes `needs_attention` and must be reconciled in Handwrytten to
   prevent duplicate billable mail.
5. A submitted order can be cancelled while Handwrytten still permits it.

The first release permits one fulfillment record per recognition. Recipient
contact and mailing columns are nullable by delivery method so the same audit
model can support an email/text e-card without storing fake postal data. Gift
fields are also present but unused by Handwrytten.

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

Apply `drizzle/0143_cherish_card_fulfillments.sql` before enabling the action.
The API key and recipient address never belong in client-side environment
variables or logs.
