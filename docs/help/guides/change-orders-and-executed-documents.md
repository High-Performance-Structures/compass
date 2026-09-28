---
{
  "id": "change.orders",
  "featureId": "change-orders",
  "slug": "change-orders-and-executed-documents",
  "title": "Change Orders and Executed Documents",
  "summary": "Create, review, approve, execute, and publish change orders with authoritative signed documents.",
  "contextSummary": "A change request is not authorization to proceed. Confirm scope, price, schedule impact, approval, signatures, and the authoritative executed PDF before treating a change as executed.",
  "category": "Project Operations",
  "tags": ["change orders", "change requests", "executed documents", "signed PDF", "owner visibility", "approval"],
  "audiences": ["staff"],
  "permissions": ["help:read", "changeorder:read"],
  "routes": ["/dashboard/projects/[id]/change-orders", "/dashboard/projects/[id]/change-orders/[changeOrderId]"],
  "owner": "Project operations",
  "lastReviewed": "2026-09-28"
}
---

## Choose and Review the Record {#review-record}

Open the project's **Change Orders** area and search before creating another record. Open the full detail view to confirm the project, request number, requester, source, audience, scope, reason, supporting files, pricing, schedule impact, status, and activity history.

An owner or trade-partner request starts review; it does not approve work, authorize cost, or change the contract. Keep clarification and later decisions on the same record instead of creating a duplicate request.

## Scope, Cost, and Status {#scope-cost-status}

Use clear scope language and reconcile every cost line and total. Record the schedule impact and internal notes separately from owner-visible language. Choose the narrowest correct audience and review the allowed status transition before saving.

Approval and execution are different states. Do not mark a change executed merely because the scope was discussed, priced, or approved internally. If the change replaces a baseline estimate rather than adding to it, use the guarded rebaseline workflow and resolve every displayed blocker before execution.

## Executed Change-Order Document {#executed-documents}

When moving an owner-visible change order to **Executed**, upload the complete signed PDF or provide its secure saved-document link, add a useful label, and attest that all required signatures are present. The PDF must be 50 MB or smaller. Compass publishes this authoritative copy through the owner workspace without requiring separate Google Drive permission.

For an older executed change order with no authoritative copy, use **Publish executed document** and record why the document is being added after execution. Do not use a proposal, unsigned draft, signature page by itself, or incomplete scan.

## Replace an Executed Copy {#replace-executed-copy}

Use **Replace active executed document** only for another presentation copy of the same fully executed change order, such as a clean archival copy replacing a watermarked scan. Provide a replacement reason and attest that no signed terms or signature content changed. Compass preserves the prior label and replacement event in project history.

If the signed terms changed, do not replace the PDF. Create or process the appropriate new change-order record and approvals so the contractual history remains accurate.

## Owner Visibility {#owner-visibility}

Owners see only change orders published to their audience. After execution, open the owner preview and confirm the status, scope, price when applicable, schedule impact, and **Open executed change order** action are correct. Replacing the active presentation copy changes the document owners open; it does not change the execution date, approval history, or signed terms.

## Quick Check {#quick-check}

- [ ] Project, request number, requester, and audience are correct.
- [ ] Scope, costs, schedule impact, and supporting files reconcile.
- [ ] The status reflects the actual approval and execution state.
- [ ] The executed PDF is complete, signed, and attached to the correct record.
- [ ] Any replacement is the same signed agreement and includes a reason.
- [ ] Owner preview shows the intended current document.
