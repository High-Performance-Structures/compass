---
{
  "id": "project.operations",
  "featureId": "rfis",
  "slug": "project-operations",
  "title": "RFIs, RFQs, Purchase Orders, and Bill Submissions",
  "summary": "Create and review RFIs, RFQs, purchase orders, and vendor bill submissions.",
  "contextSummary": "Questions, pricing requests, commitments, and vendor invoices are different controlled records. Confirm project, recipients, files, totals, approval, and Sage status.",
  "category": "Project Operations",
  "tags": ["RFI", "RFQ", "purchase orders", "vendor bills", "Sage", "bids"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/rfis", "/dashboard/purchase-orders", "/dashboard/projects/[id]/rfis", "/dashboard/projects/[id]/rfqs", "/dashboard/projects/[id]/purchase-orders"],
  "owner": "Project operations",
  "lastReviewed": "2026-10-24"
}
---

## Choose the Right Record {#choose-record}

An **RFI** asks for information or a decision. An **RFQ** requests pricing or scope confirmation. A **Purchase Order** authorizes or records a commitment. A **Bill Submission** receives an invoice for coding, approval, and accounting handoff. Search the relevant queue and confirm the active project before creating one.

## RFIs {#rfis}

Enter a clear subject and complete question, responsible contacts, response date, priority, narrowest useful audience, and supporting files. Continue the same RFI as answers and follow-up questions arrive, and keep its status current.

For a vendor-visible RFI, choose **Vendor who can see this RFI**. Every active contact at the assigned vendor company can see it; the original submitter also keeps access to their own RFI. A company name or the vendor audience alone does not grant access. Use **Save vendor** on an existing RFI to assign, replace, or remove that company. Review older unassigned RFIs in this queue and choose the correct company deliberately; Compass does not guess from their labels.

Use **Email** on an RFI to send it from Compass. Choose **To** and **Cc**, check the subject, and add an optional note; the RFI's question always follows your note. Replies come back to you and onto the RFI under **Email replies**, and the project team gets a notification. Replies stay internal until you add an approved response. Delete only an incorrect or unnecessary record using the available authorized action and review dependent tasks first.

## RFQs {#rfqs}

Describe the scope, select recipients, category, response date, priority, selections, line items, and permitted documents. Use the Sage division and cost-code pickers to code scope rows instead of typing an unrelated code. Verify each recipient and Drive link before sending; an RFQ does not grant general portal access.

Staff can email external bidders and record a response received outside Compass using the manual-response workflow. Preserve the original quote and identify whose response it is. Compare pricing, scope, exclusions, and lead time before accepting or importing it into an estimate. Use duplication to prepare a related RFQ only after checking the new project, recipients, dates, and scope.

## Replies to RFQ, P.O., and RFI Emails {#email-replies}

RFQs, purchase orders, and RFIs emailed from Compass carry a reply address for that record. When the vendor or architect replies, the reply shows on the record under **Email replies**, and the person who sent the email plus the project's staff get a notification. The sender (or the department mailbox for a P.O.) still receives the reply directly too. Quotes and P.O. updates submitted through the vendor portal notify the same people. Each email sent, reply received, and portal response is also listed in the **Activity** log.

## Purchase Orders {#purchase-orders}

Enter the vendor, scope, internal owner, ship-to details, dates, priority, and separately coded lines. Check quantities, units, costs, tax, and totals. A P.O. saved in Compass may still require approval or Sage synchronization; check status before representing it as processed.

Use **Print Preview** on a project P.O. when you need a printed vendor copy. It opens the P.O. in a new tab with **Print / Save PDF**, which opens the PDF in a browser tab, and **Email report link**. Review every page, including repeated headings, line details, totals, and the vendor signature area. Printing is a document action; it does not approve the P.O. or confirm Sage processing. Nu-Tech orders keep **Pickup copy**, which prints on the manufacturer's own form.

## Vendor Bill Submissions {#bill-submissions}

Capture vendor, invoice number and dates, amount, description, change-order context, and the original invoice. Internal reviewers check duplicates, code or split the amount, attach backup, and move it through review. Split lines should reconcile to the bill total.

**Ready for Sage** means internal preparation is complete enough for the accounting lane. It does not prove posting or payment.

## Check the Project Paper Trail in Drive {#paper-trail}

When **Project paper trail** is enabled for the project and record type, Compass saves PDF copies of purchase orders, estimates, RFIs, and change orders into their mapped project Drive folders. Working copies update after the configured quiet period; supported sending, signing, approval, or answer events can also retain a dated milestone copy. This first release does not automatically file every Compass record type.

Check the status beside a supported record. **Waiting to save to Drive** is not a completed save. Use **Open copy** to inspect the saved PDF, or **Save to Drive now** to request an update. A failure shows why the copy has not saved. If the usual folder has outside access, Compass can hold the copy in **Compass Records (internal)** instead. Report unexpected outside-access warnings to an administrator rather than broadening folder sharing.

Deleting a Compass record keeps its last Drive copy for the paper trail. Saving a PDF does not publish the record to owners, send an email, approve it, or post it to Sage. See [Company settings](/dashboard/help/company-settings) for setup and trusted-address rules.

## Nu-Tech Material Orders {#related-order-work}

Use the dedicated [Nu-Tech order process](/dashboard/help/nutech-orders) for catalog quantities, takeoff acknowledgement, payment and pickup/delivery readiness, Airlite order forms, manufacturer confirmation, and invoice release. A purchase order alone does not complete those steps.

## Quick Check {#quick-check}

- [ ] The record type and project are correct.
- [ ] I searched for an existing record.
- [ ] Recipients, audience, and linked-file access are correct.
- [ ] Lines, totals, dates, and attachments reconcile.
- [ ] I distinguished Compass workflow status from Sage posting.
