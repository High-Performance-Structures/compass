---
{
  "id": "financials",
  "featureId": "financials",
  "slug": "financial-workflows",
  "title": "Estimates, Budgets, Pay Applications, and Sage",
  "summary": "Understand estimates, budgets, G703 views, pay applications, and Sage synchronization.",
  "contextSummary": "Compass supports operational review and controlled handoff. A saved, approved, or queued record is not posted or paid until Sage confirms that state.",
  "category": "Financial Workflows",
  "tags": ["estimates", "assemblies", "customer report", "cost breakdown", "rate book", "accepted rates", "budget", "G703", "pay applications", "Sage", "accounting"],
  "audiences": ["staff"],
  "permissions": ["help:read", "finance:read"],
  "routes": ["/dashboard/financials", "/dashboard/projects/[id]/estimate", "/dashboard/projects/[id]/budget", "/dashboard/projects/[id]/financials", "/dashboard/settings"],
  "owner": "Accounting operations",
  "lastReviewed": "2026-10-16"
}
---

## System of Record {#system-of-record}

Compass provides estimating, budget, Schedule of Values/G703, pay-application, purchase-order, bill, and review workflows. Sage remains the HPS production accounting and job-cost source of truth.

Saving, approving, or queuing a Compass record does not necessarily mean it posted to Sage.

## Estimates {#estimates}

The project Estimate area may include a working Compass estimate, synchronized workbook information, bid backup, historical imports, and authorized print views. Use approved cost codes, enter quantities and costs carefully, and reconcile calculated totals. Historical files remain references unless an explicit approved workflow makes them current.

Before synchronizing an approved estimate workbook, verify the project, source tab, formulas, and totals. Compare the resulting Compass values with the source and report discrepancies before sharing or accounting handoff.

### Work on one estimate area at a time

Use **Work on** to choose **Estimate costs**, **Builder fee & markup**, **Customer report format**, **Group descriptions & report phases**, **Introduction & closing**, **Contract terms & acknowledgements**, **Contract signers**, **Approval and accounting handoff**, **Estimate details & versions**, or **Plans, specifications, and estimate basis**. Only the selected area is shown. The estimate totals and **Print Preview** remain available. Switching areas keeps unfinished entries in place; select the area's save action to persist changes. **Save draft details** saves the estimate details, text, terms, and signer fields together.

### Build and report by assembly

Use **Build estimate by** to switch between **Division / cost code** and **Assembly**. Both views edit the same estimate items and prices. **Create assembly** lets you name a group and select items from any division, including a whole division. Each item belongs to one assembly and retains its original division and cost code. The assembly editor and working estimate show subtotals. Items outside an assembly appear under **Other work**.

To reorder items in a division or assembly, drag a row's handle, use its **Move up/down** arrows, or select **Sort by cost code** for that group. Changes save automatically and persist on refresh. Sorting uses numerical cost-code order and keeps equal codes in their existing sequence. Reordering keeps each item's cost breakdowns attached and preserves prices, subtotals, division codes, and assembly membership. Division and assembly customer reports use the saved item order within each group. Both build views share this order; refresh does not automatically sort it. New items stay at the end unless you use **Insert below**, sort, or move them. Locked estimates require a revision before reordering.

Use **Edit assembly** to rename it or change its items. Selecting items from another assembly moves them into the current assembly. **Delete assembly** requires confirmation and retains its estimate items and costs under Other work. Locked estimates require a revision; revisions copy assembly names and item assignments.

In **Work on → Customer report format**, under **Client report presentation**, choose **Assembly totals**, **Assembly cost code detail**, **Division subtotals + grand total**, or **Line items + division totals**, then select **Save report view**. The existing **Phase subtotals + grand total** choice and custom report phases are also available. Assembly detail shows individual cost code items and an assembly subtotal; assembly totals show each assembly's amount. Report selection is independent of the build view. Client reports continue to exclude internal-only items and include the estimate's existing tax and builder-fee presentation.

For either assembly report view, optionally select **Show builder-fee subtotal for each assembly** and **Save report view**. Each assembly then shows its work subtotal, combined overhead/margin/contingency fee, and total including that fee. Other work receives the same treatment. Fees use only eligible items, including their sales tax, and rounding reconciles to the existing estimate fee. The project fee summary is a recap of these fees, not an additional charge. Fees for internal-only work remain in the project summary. This setting defaults to off and carries forward into revisions; division and custom-phase reports keep their existing presentation.

Division and assembly reports use grey group headings and subtotal bands, with cost codes indented beneath their group and a darker band for the group total. Totals views show the saved assembly scope or **Default CSI group descriptions** beneath the heading. Without a saved description, the report summarizes the customer-visible cost code scopes. Edit assembly descriptions with **Edit assembly**; edit division descriptions in **Work on → Group descriptions & report phases**.

**Show cost breakdowns in customer report** defaults to off. Enable it and select **Save report view** to include underlying labor, material, and other cost rows beneath itemized cost codes. Totals-only and lump-sum groups stay summarized. This presentation setting carries forward into copies and revisions; it does not change working estimate details or amounts.

## Price a Change Order with an Estimate {#change-order-estimates}

On a change order, choose **Build change-order estimate**. It opens a full estimate for just that change, numbered after the change order (for example H-430-1900-CO-001). It has the same lines, assemblies, report phases, Print Preview, printing and signature options as the contract estimate. The client, signers, terms and report style start from the accepted contract estimate.

To offer one assembly as its own later phase, open the contract estimate, switch to the assembly view and choose **Export as phase** on that assembly. Name the phase. Compass creates a separate phase estimate (numbered like H-430-1900-P1) with just that assembly, priced with the contract estimate's builder-fee rates, to print, sign and approve on its own. Nothing changes in the contract estimate or the project family until the phase estimate is accepted. When it is accepted, the phase is added to the project family (the family is created if the job doesn't have one yet), authorized at the accepted amount and ready to activate, and the assembly comes out of the contract estimate. If the contract estimate is already signed, Compass drafts a deduct change order for the assembly instead, to approve like any change order; if it is out for signature, it stays as it is and Compass says so. The contract estimate lists its **Phase estimates**; delete one that isn't accepted and the contract estimate stays as it is.

Send it for signature with Foxit, or mark it signed outside Compass and record the acceptance with the signed document, exactly as for the contract estimate. Accepting it executes the change order:

- Its lines become the change order's cost-code lines, at the client price.
- Its total becomes the change-order amount.
- The signed document is attached to the change order.

The contract budget then rebuilds with the change added. The contract estimate itself is not changed. A new version of a change-order estimate stays on the same change order.
## Choose the Documents in a Contract Packet {#contract-packet-documents}

When you create a contract packet on the **Contracts** page, choose the estimate, then tick the documents to include. The agreement (CA00) and the construction estimate (CA22) are always included, because the packet can't be signed without them. Every other document is optional. After the packet is created you can still **Add document** or **Remove** one while it's being prepared.

Admins can tick **Use this selection as the default for new contract packets** to make the current choice the company default. New packets then start with the same documents ticked.

## Budget and G703 {#budget-g703}

Review original and adjusted estimates, approved changes, scheduled value, prior and current applications, stored materials, completed work, balance to finish, and retainage where applicable. Detail and owner visibility depend on the project, contract, department, and role.

## Contract Deposits {#contract-deposits}

Record deposits on a project's **Financials** page under **Contract deposits**. Choose **Record deposit**, then save it as **Requested** (amount and due date) or **Received** (amount, date, how it was paid and the check or reference number). If the contract packet sets a deposit percentage, the amount starts from that. Open a requested deposit and choose **Record payment** when the money arrives. **Void** removes a deposit you entered by mistake.

A received deposit is applied to pay applications before the client pays the balance. By default Compass applies as much of the unapplied deposit as each new draft pay application can take, starting with the oldest draft. On the pay application, **Less deposit applied** shows the amount; type a different amount and choose **Apply amount**, or **Apply automatically** to go back. Admins can turn automatic application off in Settings under **Contract deposits**.

## Pay Applications {#pay-applications}

Bill a draft pay application by dollars or by percent complete. **Bill by** groups the lines by **Division**, **Assembly** or **Cost code**. Each group has a percent box: type its percent complete to date and choose **Bill division**, **Bill assembly** or **Bill cost code**, and every line in it is billed to that percent of its scheduled value, less previous work and stored materials. To bill a single line, type its **% to date** or its current work in dollars and save the line. Compass refuses a percent lower than what is already billed.

Pay application lines follow the accepted estimate's assemblies: a cost code used by several assemblies has one line per assembly, and each executed change order is its own group. Lines in a cost code that no assembly claims show as **Other work**. Sage still receives one G703 line per cost code. If the estimate's assemblies change after a draft is made, choose **Update assemblies** on the draft; work already entered carries over.

**Client sees** sets how much of this pay application the client sees: **Division, % complete only** (each division's percent complete and the payment due, with no line amounts), **Division with amounts**, **Assembly, % complete only**, **Assembly with amounts**, or **Cost code with amounts**. **Company default** follows the setting admins choose in Settings under **Pay applications**.

A Buildertrend estimate import turns each Parent Group into an estimate assembly as well as a report phase.

When a change order is executed, draft pay applications move to the new contract budget revision on their own, and the change shows in the **Changes** column and the contract sum. Work already entered is kept. If a draft still shows an older revision, choose **Update to revision N** on it. Submitted pay applications keep the revision they were prepared against.

**Delete draft** removes a draft pay application and the work entered on it, and frees any deposit it applied. Submitted pay applications can't be deleted.

**Ready for review** locks the draw so it can be reviewed and entered in Sage; Compass asks you to confirm first. While it's in internal review, **Return to draft** unlocks it for more edits.

Every Compass document prints the same way: **Print Preview** opens it in a new tab with **Print / Save PDF** (the PDF opens in a browser tab) and **Email report link**. An accepted estimate, including an accepted change-order estimate, previews its signed document the same way. A PDF longer than one page shows "Page X of N" at the foot of each page. On an estimate preview, the menu at the top of the bar prints the **Entire estimate** or one assembly, division or phase. A single section prints as an excerpt: its lines, its share of the builder fee and its own total, noted as part of the full estimate, with no signature page. That covers estimates and version comparisons, pay applications, the budget G703, change orders, contract packets, P.O.s, RFQs, shop tickets, owner updates, daily logs, selections, schedules, warranty requests, RFIs and directories. Documents built from the filters on your screen (schedules, selections, the budget and client-portal reports) are saved as a private preview only you can open, so they have no **Email report link**.

**Print Preview** opens the client copy in a new tab at any status, without changing the draw. It prints in landscape: page 1 is the G702 application and certificate for payment, with the contractor certification and a **Reviewed and approved** block for the reviewer's amount certified, signature, printed name and date. The G703 continuation sheet follows, with columns for original contract sum, prior and current changes, adjusted estimate, prior and current costs, completed to date, percent complete and balance. Its first column follows **Client sees**: the percent levels print one combined row per assembly or division, Assembly and Division also list the cost codes under each group, and Cost code lists every cost code. **Print / Save PDF** opens the PDF in a browser tab; **Email report link** starts an email with the preview link.

Before marking a pay application ready, verify period and draw number, prior applications and payments, current work, stored materials, approved changes, retainage, balance, backup, and required approval. Do not call it invoiced, posted, or paid until Sage confirms that state.

## Sage Status {#sage-status}

Compass status may distinguish Compass-only, pending review, queued, syncing, synced, failed, or read-only data. Missing mapping means a project, company, phase, cost code, or other required identity must be corrected before handoff.

Only authorized staff should queue Sage writes. Confirm identity, mapping, amounts, dates, approvals, and that the record was not already entered directly. Never retry blindly: delayed responses can create duplicate accounting work.

## Sage Unavailable {#sage-unavailable}

Continue preparing permitted operational records in Compass, leave them in a non-posted state, record what happened during the outage, and reconcile the queue after service returns. Compass should support continuity without becoming a conflicting ledger.

## Use the Accepted Rate Book {#rate-book}

Open **Settings → Rate book** to review accepted labor, equipment, material, and other rates. Authorized staff can add and edit entries, set their status, and inspect the history of prior values. Review the unit, cost, markup, default cost code, fuel assumptions when present, and change note. The default cost code is optional: leave it blank for a rate used on different work, such as a machine used for both excavation and backfill, and choose the cost code each time you use the rate. Retire a rate that should no longer be selected. Deletion requires confirmation; a rate already used is retained through retirement rather than losing its history.

**From rate book** appears on estimate lines, their cost breakdowns, and estimate template lines. Every filled value stays editable, so you can override a rate for one job. On a shop ticket, choose each line's rate by name and type a different amount in its Rate box to override it. A shop ticket line with no cost code takes the rate's default cost code; a cost code you choose is never replaced.

In an estimate's cost breakdown, choose the cost code and use **From rate book** to fill the description, unit, cost, and markup. A rate's default cost code fills the entry only when no cost code is chosen yet. Then check quantity, unit, markup, tax, and coding before saving. The estimate keeps the selected rate version. A later rate-book edit does not silently reprice it: **Review new rate** lets you inspect and apply a newer value to editable work. Locked estimates still require the normal revision workflow.

## Customize Report Phases and Duplicate Estimates {#estimate-phases}

Use **Work on → Group descriptions & report phases** to customize client report phase names and grouping across departments. Keep report grouping separate from the division and cost-code identities used for accounting.

A report phase can gather lines from any division, like a scope package ("Footer Labor & Materials" with its mobilization, forming, rebar and concrete lines). The division you choose for a phase only sets where it sorts in the report. Leave **Itemize** off to show just the package description and total, the way H proposals usually read.

### Import a Buildertrend estimate

On a draft estimate, choose **Import Buildertrend estimate** and pick the estimate report exported from Buildertrend as a spreadsheet. Each Buildertrend row becomes an estimate line, and each parent group becomes a report phase with its description, shown as a package total. Amounts are kept exactly as exported, so check the import total against the signed proposal before you continue. Rows marked as options, or rows with tax, can't be imported yet.

To bring in a contract that was already signed in Buildertrend, start a new version of the job's estimate, import the export, mark it signed outside Compass, and record the acceptance with the signed document. Accepting it builds the contract budget.

### Several estimates on one job

Some departments sell several things separately, so a job can have several estimates at once (for example a bracing rental and an ICF block order). Admins choose this per department in **Settings → Workflows → Estimates**: **One contract estimate** (the accepted estimate becomes the contract budget and later changes go through change orders) or **Several at once**.

With several at once, the Estimate page lists **Estimates on this job**. Each estimate has its own number (for example -01 and -02) and its own versions, and is sent and accepted on its own: accepting one never changes the others, and no contract budget is built. **New estimate** starts another one. **Duplicate estimate** asks whether the copy is **a separate estimate** (the next number, with the original left as it is) or **a new version** of the same estimate (it replaces the open version, which is kept for the record). Signatures and acceptance are never copied.

**Duplicate estimate** can copy an estimate into another activated project phase in the same family. Confirm the destination project and version before copying, then review its quantities, rates, tax, descriptions, and terms before sharing. A copied estimate is a new working record, not approval or Sage posting.

## Quick Check {#quick-check}

- [ ] Project, company, period, and identifiers are correct.
- [ ] Totals reconcile to source records.
- [ ] Cost codes, changes, retainage, and prior payments were reviewed.
- [ ] I know whether Sage actually accepted the operation.
- [ ] I checked for duplicates before queueing or retrying.
