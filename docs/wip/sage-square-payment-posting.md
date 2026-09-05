# Square to Sage payment posting

## Accounting policy

Compass automatically accepts completed payments for invoices created by the
Sage-to-Square bridge. It does not ask for a second approval after the invoice
has been sent.

- Compass applies the owner payment to the matching Square invoice and stages
  a supported Sage 3-3-2 posting task so the full owner-paid amount reduces
  accounts receivable after the posting step.
- Square settlement activity uses Sage account **10000 — FSB Project
  Checking**.
- Square processing fees use Sage account **62020 — Merchant Service Fees**.
- A separately identified client-paid merchant fee uses the same merchant fee
  account as an offset. The current bridge does not add a client fee, so the
  value is normally zero.
- H-prefixed jobs route to HPS, O-prefixed jobs route to ORC, N-prefixed jobs
  route to Nu-Tech, and legacy D-prefixed jobs route to ORC.

These account numbers were resolved from the active Sage company. They are
explicitly pinned in the queue payload so a writer cannot silently select a
different bank or expense account.

## Eligibility and cutoff

Only signed `invoice.payment_made` events are allowed to create Sage payment
operations. The invoice must contain both bridge markers:

- `Sage Record` custom field with the numeric Sage invoice record ID.
- `Sage Job` custom field matching exactly one open Compass project number.
- `Source record RECORD_ID.` in the Square invoice description.

Compass retrieves the Square order and payment before enqueueing anything. It
requires the deterministic order reference, exact location-to-job routing,
completed USD payment status, zero tip, and zero refund. The production cutoff
is `2026-08-29T00:15:00.000Z`; Square events and payments older than the cutoff
are never backfilled. An invoice may have been sent before the cutoff and still
qualify when its actual payment is completed afterward.

Refunds, failed scheduled charges, routing mismatches, unexpected tips,
currency mismatches, and fee reductions stop automatic posting and create a
deduplicated high-priority Compass notification for active administrators.

## Queue and idempotency

Migration `0138_sage_square_payment_queue.sql` adds:

- `sage_square_webhook_events` for Square event deduplication and processing
  audit.
- `sage_square_payment_operations` for HMAC-authenticated Sage writer claims.

Each Square payment has a deterministic receipt idempotency key. Processing
fees are stored as positive deltas against the latest total Square fee, so a
later fee update does not duplicate an already queued or posted amount.
Migration `0150_sage_square_receipt_projects.sql` adds the organization,
Compass project, and Sage job short-name linkage used to scope the queue and
notifications.

## Production configuration

Cloudflare secrets:

- `SQUARE_PRODUCTION_ACCESS_TOKEN`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SAGE_BRIDGE_SECRET`

Cloudflare variables:

- `SAGE_SQUARE_ORGANIZATION_ID=org-1` pins this HPS Square merchant bridge to
  its Compass organization before project-number matching.
- `SAGE_SQUARE_PAYMENT_WEBHOOK_ENABLED=true`
- `SAGE_SQUARE_PAYMENT_CUTOFF_AT=2026-08-29T00:15:00.000Z`
- `SAGE_SQUARE_PAYMENT_WRITES_ENABLED=false` until the supported processing-fee
  general-ledger writer passes its controlled validation. This switch never
  exposes receipt operations.

The Square application subscription uses the exact notification URL in
`square-webhook-auth.ts` and these event types:

- `invoice.payment_made`
- `invoice.refunded`
- `invoice.scheduled_charge_failed`
- `payment.updated`

Use `scripts/square_webhook_subscription.py` through the approved secret
injector to create or verify the subscription. Pipe `--signature-key-only`
directly into the Cloudflare secret command; do not display or save the key.
The helper accepts the Cloudflare-style `SQUARE_PRODUCTION_ACCESS_TOKEN` name
and the private bridge's existing `HPS_SQUARE_PRODUCTION_ACCESS_TOKEN` alias.

## Installed Sage API result and supported workflow

The installed `mbxml.xsd` contains `APInvoicePayAddRq` for vendor payments,
but it does not contain an A/R receipt or customer-payment add request. It
contains `ARInvoiceAddRq`, `ARInvoiceQryRq`, and general-ledger adds; a general
ledger add alone must not be used to imitate a customer receipt because it
would leave the A/R invoice and subledger inconsistent.

For every eligible Square payment, Compass therefore:

1. stores the full owner payment as `manual_action_required` against the exact
   Sage invoice and active Compass project, then sends one deduplicated in-app
   notification to active administrators in that project organization;
2. tells the administrator to use Sage **3-3-2 Electronic Receipts**, choose
   **Post** rather than **Process and Post**, apply the full amount to the
   invoice, and use account **10000 — FSB Project Checking**; and
3. keeps the Square processing-fee operation separate for account **62020 —
   Merchant Service Fees** and the supported general-ledger writer path.

The ten-minute Compass maintenance cycle also converts any receipt left in the
legacy `queued` state, or a legacy claim that has been stale for more than ten
minutes, and creates its notification. Both the state transition and
notification delivery are idempotent, so a retry cannot create a second
posting task.

This is a Sage posting and reconciliation step, not a second approval of the
Square payment. Receipt operations are never exposed through the bridge writer
endpoint. Direct SQL writes remain prohibited.

The existing company **Financials → Payments** tab and each active project's
**Financials** page show a dedicated Square receipt queue. It includes the
linked project and client, Sage invoice and record, Square payment ID, gross
receipt, Square fee, deposit/fee accounts, timestamps, and independent
receipt/fee statuses. Notification links open the project Financials page and
highlight the exact receipt. The view does not offer an approval control.

## Sage API diagnostics and fee-writer activation

Writes must use the existing `jarvis.api` Sage API identity. Direct SQL writes
are prohibited even if the SQL login has inherited write permissions.

Before implementing or enabling the Windows writer, run this read-only command
on the Sage Windows host:

```powershell
powershell -ExecutionPolicy Bypass -File .\inspect_sage_payment_mbxml.ps1
```

The output identifies the installed MBXML request names and required fields.
Use the installed schema, validate every XML request locally, and run one
explicitly controlled processing-fee test before setting
`SAGE_SQUARE_PAYMENT_WRITES_ENABLED=true`. That switch enables claims only for
`post_square_processing_fee`; it cannot enable receipt claims.

The writer endpoints are:

- `GET /api/integrations/sage/square-payments/requests?limit=5`
- `POST /api/integrations/sage/square-payments/results`

They use the existing timestamped HMAC, single-use request ID, random claim
token, and ten-minute lease. The writer must read back the created Sage record
before returning success. It must not expose modify, void, reverse, or delete
operations.

## Rollback

Set `SAGE_SQUARE_PAYMENT_WRITES_ENABLED=false` to stop Sage claims without
losing queued payments. Set `SAGE_SQUARE_PAYMENT_WEBHOOK_ENABLED=false` only if
Square event intake must also stop. Do not delete queued operations or webhook
events; they are the reconciliation audit trail.
