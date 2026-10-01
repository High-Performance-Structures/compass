# Square payment alerts for the Sage invoice creator

This adds an in-app payment-received alert to the employee who originally
created the Sage AR invoice. Existing administrator posting/error notifications
remain unchanged. No Sage writes, Square billing, approval, or receipt status
changes are performed by the employee-alert path.

## Workflow

1. The existing authenticated Square payment workflow validates the completed
   payment and imports its receivable, payment, allocation, and project links.
2. The private one-minute lookup timer fetches pending receipt identities from
   the exact HMAC-authenticated `/api/integrations/sage/square-invoice-creators`
   endpoint. It reads `acrinv.insusr` using the Sage read-only SQL account and
   verifies the exact invoice record, invoice number, and job before reporting.
3. Compass maps that original Sage username to one explicit Compass user ID.
   It never guesses from names/emails, uses the importer, or uses `updusr`.
   The recipient must be active, belong to the same active internal organization,
   have finance read access, and have in-app notifications enabled.
4. The employee sees “Square payment received for Sage invoice …” in the
   notification bell. Opening it goes directly to that project's Financials tab
   and the existing Square receipt detail. The message distinguishes receipt
   posting in Sage from payment receipt; it is not another approval request.
5. Missing or unauthorized mappings produce a deduplicated administrator routing
   alert. They do not block accounting. Fixing the mapping/preferences allows
   the maintenance cron to deliver the employee alert and dismiss the routing
   alert. A missing Sage creator is reread hourly. Existing active mappings retry
   delivery on the existing one-minute receipt maintenance cron.

Event/recipient inserts and the notification marker are committed in one D1
batch. Deterministic IDs prevent duplicate alerts on overlapping reports/retries.
In-app preferences are respected. This feature does not send email, push, or SMS.
General integration errors still go to administrators; the employee payment alert
does not constitute an exception-resolution or accounting task assignment.

## Rollout

1. Apply migration `0162_square_invoice_creator_alerts.sql` before deploying.
2. Configure `SAGE_SQUARE_ORGANIZATION_ID` and protect
   `SAGE_INVOICE_CREATOR_USER_MAP` as a Worker secret containing an exact JSON
   array, for example `[{"sageUsername":"invoice.operator","userId":"user_example"}]`.
   Verify each employee's actual business account and organization membership.
   No real mappings, account IDs, addresses, or tokens belong in source control.
3. Set `SAGE_SQUARE_CREATOR_ALERTS_FROM` to an explicit UTC ISO timestamp. Only
   payments completed at or after it are alerted; choose this deliberately to
   avoid flooding employees with historical payments. An absent/invalid map or
   cutoff disables this path without affecting billing/receipt maintenance.
4. Deploy the Worker. Install the poller alongside its existing bridge,
   auth-monitor, and secret-exec helper dependencies on the private bridge host.
   Install/enable the supplied `compass-square-invoice-creators` service/timer.
   The SQL password and secondary HMAC secret are injected by the existing
   protected broker; the public origin is a CLI argument, not an inherited env var.
5. Verify service success, a receipt's lookup/notification timestamps, and the
   exact employee's in-app recipient row. Confirm its Financials link resolves
   to the existing Sage invoice/payment. Do not create a test charge or invoice.

To pause routing, stop the lookup timer and remove the mapping/cutoff config.
Changing/removing a mapping uses deployment secret administration, not a new
employee-editable record workflow. Already delivered notifications are retained.
