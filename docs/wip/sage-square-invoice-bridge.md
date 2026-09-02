# Sage to Square invoice bridge

The private Sage bridge can create Square invoices from Sage 100 Contractor
A/R invoices without granting Compass or Cloudflare direct access to Sage SQL
or Square credentials.

## Routing

The Sage job-number prefix selects the Square location:

| Sage job prefix | Square location |
| --- | --- |
| `H-` | HPS |
| `O-` | ORC |
| `N-` | Nu-Tech |
| `D-` | ORC |

The job prefix is authoritative because the live Sage `actrec.dptmnt` field is
often blank. When `dptmnt` contains a recognized historical value, the bridge
also checks it and stops if it conflicts with the job prefix. Unknown job
prefixes always fail closed.

## Safety model

- Sage access is read-only and uses the existing restricted SQL login.
- Secrets are injected at runtime; they are never command-line values or
  checked-in configuration.
- Preview is the default and performs no Square writes.
- Creating a draft and publishing are separate explicit operations.
- Every write requires the operator to repeat the exact current Sage invoice
  number.
- Deterministic Square idempotency keys and a Sage source marker prevent
  duplicate invoices on retries.
- A draft must still match the Sage total, Square location, confirmed customer,
  and invoice number before it can be published.
- Existing Square invoice numbers without the Sage source marker stop the run
  for manual review.
- The Sage client email is used by default. A command-line override must match
  the Sage email when both are present.
- A missing Square customer may be created only during an explicitly confirmed
  draft write with `--create-customer`. The bridge searches by exact email
  first and uses a deterministic Sage-client idempotency key and reference ID.
- Sage sales tax is represented as an order-level Square tax. Square calculates
  the order before creation, and the bridge stops unless the calculated total
  exactly matches Sage.

## Required secrets

- `HPS_SAGE_SQL_PASSWORD`
- `HPS_SQUARE_PRODUCTION_ACCESS_TOKEN` for production
- `HPS_SQUARE_SANDBOX_ACCESS_TOKEN` for sandbox testing

## Operator flow

Run the script through the approved secret injector on the private bridge host.
The examples use placeholders deliberately.

Preview:

```bash
signet secret exec \
  -s HPS_SAGE_SQL_PASSWORD \
  -s HPS_SQUARE_PRODUCTION_ACCESS_TOKEN \
  -- python3 sage_square_invoice_bridge.py \
  --sage-invoice-id SAGE_RECORD_ID \
  --environment production
```

If Sage has no email yet, `--recipient-email RECIPIENT_EMAIL` may be supplied.
If Sage already has an email, the override must match it exactly.

Create a non-sending draft after reviewing the preview:

```bash
signet secret exec \
  -s HPS_SAGE_SQL_PASSWORD \
  -s HPS_SQUARE_PRODUCTION_ACCESS_TOKEN \
  -- python3 sage_square_invoice_bridge.py \
  --sage-invoice-id SAGE_RECORD_ID \
  --recipient-email RECIPIENT_EMAIL \
  --environment production \
  --create-draft \
  --create-customer \
  --confirm-invoice-number 'EXACT CURRENT SAGE INVOICE NUMBER'
```

Omit `--create-customer` when the matching Square customer already exists. If
the exact-email search returns no match, the bridge stops without creating the
draft and explains which flag is required. More than one match always stops for
manual review.

Publish only after re-running preview and confirming the recipient, amount, due
date, job prefix, location, and draft status:

```bash
signet secret exec \
  -s HPS_SAGE_SQL_PASSWORD \
  -s HPS_SQUARE_PRODUCTION_ACCESS_TOKEN \
  -- python3 sage_square_invoice_bridge.py \
  --sage-invoice-id SAGE_RECORD_ID \
  --recipient-email RECIPIENT_EMAIL \
  --environment production \
  --publish \
  --confirm-invoice-number 'EXACT CURRENT SAGE INVOICE NUMBER'
```

Publishing instructs Square to email the customer and activates the hosted
payment page. It is an external financial communication and requires explicit
operator approval.

Completed payments for bridge-owned invoices are handled by the separate
[Square to Sage payment posting runbook](sage-square-payment-posting.md). The
payment workflow uses `jarvis.api`, posts all Square settlement activity to FSB
Project Checking, and sends Compass notifications for exceptions rather than
requiring another payment approval.
