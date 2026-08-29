# Square to Sage payment posting

## Accounting policy

Compass automatically accepts completed payments for invoices created by the
Sage-to-Square bridge. It does not ask for a second approval after the invoice
has been sent.

- The owner payment is applied to the matching Sage receivable invoice so the
  full owner-paid amount reduces accounts receivable.
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

## Production configuration

Cloudflare secrets:

- `SQUARE_PRODUCTION_ACCESS_TOKEN`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SAGE_BRIDGE_SECRET`

Cloudflare variables:

- `SAGE_SQUARE_PAYMENT_WEBHOOK_ENABLED=true`
- `SAGE_SQUARE_PAYMENT_CUTOFF_AT=2026-08-29T00:15:00.000Z`
- `SAGE_SQUARE_PAYMENT_WRITES_ENABLED=false` until the installed Sage API
  schema diagnostics and controlled write validation pass.

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

## Sage API diagnostics and activation

Writes must use the existing `jarvis.api` Sage API identity. Direct SQL writes
are prohibited even if the SQL login has inherited write permissions.

Before implementing or enabling the Windows writer, run this read-only command
on the Sage Windows host:

```powershell
powershell -ExecutionPolicy Bypass -File .\inspect_sage_payment_mbxml.ps1
```

The output identifies the installed MBXML request names and required fields for
cash receipts and bank charges. Use the installed schema, validate every XML
request locally, and run one explicitly controlled test before setting
`SAGE_SQUARE_PAYMENT_WRITES_ENABLED=true`.

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
