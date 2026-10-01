---
{
  "id": "financials",
  "featureId": "financials",
  "slug": "financial-workflows",
  "title": "Estimates, Budgets, Pay Applications, and Sage",
  "summary": "Understand estimates, budgets, G703 views, pay applications, and Sage synchronization.",
  "contextSummary": "Compass supports operational review and controlled handoff. A saved, approved, or queued record is not posted or paid until Sage confirms that state.",
  "category": "Financial Workflows",
  "tags": ["estimates", "budget", "G703", "pay applications", "Sage", "sync", "accounting"],
  "audiences": ["staff"],
  "permissions": ["help:read", "finance:read"],
  "routes": ["/dashboard/financials", "/dashboard/projects/[id]/estimate", "/dashboard/projects/[id]/budget", "/dashboard/projects/[id]/financials"],
  "owner": "Accounting operations",
  "lastReviewed": "2026-09-30"
}
---

## System of Record {#system-of-record}

Compass provides estimating, budget, Schedule of Values/G703, pay-application, purchase-order, bill, and review workflows. Sage remains the HPS production accounting and job-cost source of truth.

Saving, approving, or queuing a Compass record does not necessarily mean it posted to Sage.

## Estimates {#estimates}

The project Estimate area may include a working Compass estimate, synchronized workbook information, bid backup, historical imports, and authorized print views. Use approved cost codes, enter quantities and costs carefully, and reconcile calculated totals. Historical files remain references unless an explicit approved workflow makes them current.

Before synchronizing an approved estimate workbook, verify the project, source tab, formulas, and totals. Compare the resulting Compass values with the source and report discrepancies before sharing or accounting handoff.

### Build and report by assembly

Use **Build estimate by** to switch between **Division / cost code** and **Assembly**. Both views edit the same estimate items and prices. **Create assembly** lets you name a group and select items from any division, including a whole division. Each item belongs to one assembly and retains its original division and cost code. The assembly editor and working estimate show subtotals. Items outside an assembly appear under **Other work**.

Use **Edit assembly** to rename it or change its items. Selecting items from another assembly moves them into the current assembly. **Delete assembly** requires confirmation and retains its estimate items and costs under Other work. Locked estimates require a revision; revisions copy assembly names and item assignments.

Under **Client report presentation**, choose **Assembly totals**, **Assembly cost code detail**, **Division subtotals + grand total**, or **Line items + division totals**, then select **Save report view**. The existing **Phase subtotals + grand total** choice and custom report phases are also available. Assembly detail shows individual cost code items and an assembly subtotal; assembly totals show each assembly's amount. Report selection is independent of the build view. Client reports continue to exclude internal-only items and include the estimate's existing tax and builder-fee presentation.

For either assembly report view, optionally select **Show builder-fee subtotal for each assembly** and **Save report view**. Each assembly then shows its work subtotal, combined overhead/margin/contingency fee, and total including that fee. Other work receives the same treatment. Fees use only eligible items, including their sales tax, and rounding reconciles to the existing estimate fee. The project fee summary is a recap of these fees, not an additional charge. Fees for internal-only work remain in the project summary. This setting defaults to off and carries forward into revisions; division and custom-phase reports keep their existing presentation.

## Budget and G703 {#budget-g703}

Review original and adjusted estimates, approved changes, scheduled value, prior and current applications, stored materials, completed work, balance to finish, and retainage where applicable. Detail and owner visibility depend on the project, contract, department, and role.

## Pay Applications {#pay-applications}

Before marking a pay application ready, verify period and draw number, prior applications and payments, current work, stored materials, approved changes, retainage, balance, backup, and required approval. Do not call it invoiced, posted, or paid until Sage confirms that state.

## Sage Status {#sage-status}

Compass status may distinguish Compass-only, pending review, queued, syncing, synced, failed, or read-only data. Missing mapping means a project, company, phase, cost code, or other required identity must be corrected before handoff.

Only authorized staff should queue Sage writes. Confirm identity, mapping, amounts, dates, approvals, and that the record was not already entered directly. Never retry blindly: delayed responses can create duplicate accounting work.

## Sage Unavailable {#sage-unavailable}

Continue preparing permitted operational records in Compass, leave them in a non-posted state, record what happened during the outage, and reconcile the queue after service returns. Compass should support continuity without becoming a conflicting ledger.

## Quick Check {#quick-check}

- [ ] Project, company, period, and identifiers are correct.
- [ ] Totals reconcile to source records.
- [ ] Cost codes, changes, retainage, and prior payments were reviewed.
- [ ] I know whether Sage actually accepted the operation.
- [ ] I checked for duplicates before queueing or retrying.
