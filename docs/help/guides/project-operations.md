---
{
  "id": "project.operations",
  "featureId": "rfis",
  "slug": "project-operations",
  "title": "RFIs, RFQs, Purchase Orders, and Bill Submissions",
  "summary": "Create and review RFIs, RFQs, bidder emails and responses, purchase orders, and vendor bill submissions.",
  "contextSummary": "Questions, pricing requests, commitments, and vendor invoices are different controlled records. Confirm project, recipients, files, totals, approval, and Sage status.",
  "category": "Project Operations",
  "tags": ["RFI", "RFQ", "bidder email", "manual response", "Sage divisions", "cost codes", "purchase orders", "vendor bills", "Sage", "bids"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/rfis", "/dashboard/purchase-orders", "/dashboard/projects/[id]/rfis", "/dashboard/projects/[id]/rfqs", "/dashboard/projects/[id]/purchase-orders"],
  "owner": "Project operations",
  "lastReviewed": "2026-10-05"
}
---

## Choose the Right Record {#choose-record}

An **RFI** asks for information or a decision. An **RFQ** requests pricing or scope confirmation. A **Purchase Order** authorizes or records a commitment. A **Bill Submission** receives an invoice for coding, approval, and accounting handoff. Search the relevant queue and confirm the active project before creating one.

## RFIs {#rfis}

Enter a clear subject and complete question, responsible contacts, response date, priority, narrowest useful audience, and supporting files. Continue the same RFI as answers and follow-up questions arrive, and keep its status current. Delete only an incorrect or unnecessary record using the available authorized action and review dependent tasks first.

## RFQs {#rfqs}

Describe the scope, select recipients, category, response date, priority, selections, line items, and permitted documents. For new scope rows, choose the active **Sage division** and **Sage cost code** when applicable. The cost-code list narrows to the selected division. Replace values marked as not active in Sage, and correct any cost code that belongs to a different division before using the RFQ for estimating or accounting handoff.

Use **Send email** to send the full RFQ scope and its project Drive viewer links to a bidder who does not have a Compass account. Review the To and Cc addresses, subject, message, scope-line count, and included document list. Compass grants each recipient viewer access to the linked project files before sending; Google may ask a recipient without a Google account to verify their email. Creating or emailing an RFQ does not grant general Compass portal access. Confirm the delivery history before retrying a failed or uncertain send.

When a quote or decline arrives by email, phone, or another channel, use **Record response**. Record the received date, source, responder, each scope price, total, lead time, validity date, source reference, and notes. The quoted total is calculated from line prices when scope lines exist. Corrections appear in the manual response history with the recorder and time. Approved pricing is locked, so reconcile the source response before approval.

When bids return, preserve the original response, compare scope and exclusions, document the decision, and use the approved estimate/import workflow rather than silently replacing source information.

## Purchase Orders {#purchase-orders}

Enter the vendor, scope, internal owner, ship-to details, dates, priority, and separately coded lines. Check quantities, units, costs, tax, and totals. A P.O. saved in Compass may still require approval or Sage synchronization; check status before representing it as processed.

Use **Pickup copy** on a project P.O. when you need a printed vendor copy. Review the print preview across all pages, including repeated headings, line details, totals, and the vendor signature area. Printing is a document action; it does not approve the P.O. or confirm Sage processing.

## Vendor Bill Submissions {#bill-submissions}

Capture vendor, invoice number and dates, amount, description, change-order context, and the original invoice. Internal reviewers check duplicates, code or split the amount, attach backup, and move it through review. Split lines should reconcile to the bill total.

**Ready for Sage** means internal preparation is complete enough for the accounting lane. It does not prove posting or payment.

## Quick Check {#quick-check}

- [ ] The record type and project are correct.
- [ ] I searched for an existing record.
- [ ] Recipients, audience, and linked-file access are correct.
- [ ] Lines, totals, dates, and attachments reconcile.
- [ ] I distinguished Compass workflow status from Sage posting.
