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
  "lastReviewed": "2026-09-05"
}
---

## System of Record {#system-of-record}

Compass provides estimating, budget, Schedule of Values/G703, pay-application, purchase-order, bill, and review workflows. Sage remains the HPS production accounting and job-cost source of truth.

Saving, approving, or queuing a Compass record does not necessarily mean it posted to Sage.

## Estimates {#estimates}

The project Estimate area may include a working Compass estimate, synchronized workbook information, bid backup, historical imports, and authorized print views. Use approved cost codes, enter quantities and costs carefully, and reconcile calculated totals. Historical files remain references unless an explicit approved workflow makes them current.

Before synchronizing an approved estimate workbook, verify the project, source tab, formulas, and totals. Compare the resulting Compass values with the source and report discrepancies before sharing or accounting handoff.

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
