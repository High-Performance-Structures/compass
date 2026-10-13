---
{
  "id": "nutech.orders",
  "featureId": "nutech-orders",
  "slug": "nutech-orders",
  "title": "Nu-Tech Sales and Order Process",
  "summary": "Move Nu-Tech jobs from sales intake through catalog quantities, approval, payment, Airlite ordering, and fulfillment.",
  "contextSummary": "The order stepper links to missing requirements. Verify quantities, acknowledgement, payment, delivery or pickup details, PO release, and manufacturer confirmation separately.",
  "category": "Project Operations",
  "tags": ["Nu-Tech", "Fox Blocks", "Airlite", "catalog", "bundles", "sales", "delivery", "pickup", "takeoff", "EPS", "order emails"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/nutech", "/dashboard/nutech/catalog", "/dashboard/projects/[id]/nutech"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-10"
}
---

## Find the Sales Job {#sales}

Use **Nu-Tech Sales** in the dashboard portfolio window to review the sales pipeline and open a job. Authorized staff can move jobs between the offered stages; these are real job-status changes. Check the customer, job number, delivery method, and follow-up flag before advancing it. Open **Nu-Tech Order Process** for the full workflow.

## Follow the Order Stepper {#stepper}

The job overview shows **Intake**, **Quantities**, **Estimate**, **Approval & payment**, **Ready to order**, **Order placed**, **Confirmed**, **Vendor invoice**, and **Complete**. Open the current step and follow its checklist links to the missing record or field. A completed checklist entry reflects recorded evidence; verify the supporting document or actual payment rather than advancing the status alone.

## Several Orders and Estimates on One Job {#several-orders}

A Nu-Tech job can have several orders, for example block for each phase of a build, and several estimates (bracing rental, ICF block, and so on). The order page lists the job's orders at the top; choose one to open it, or choose **New order** to start another. A new order copies the open order's customer, pricing, delivery and tax district, and starts with no products. Give an order a name, such as "Phase 2 walls", to tell orders apart.

Each order fills its own estimate: **Create estimate from order** fills that order's estimate (its newest version) or starts a new estimate for an order that has none. Each order has its own manufacturer PO and order form.

On the Estimate page, **Next step** shows the order filling each estimate. An accepted estimate with no order yet offers **Start order** and a link to bracing rentals. Whether a department allows several estimates per job is set in **Settings → Workflows → Estimates**.

## Record Intake and Catalog Quantities {#intake}

Add the customer as a client contact, choose delivery or customer pickup, supply a delivery address when required, and save intake with the quantity source. A staff takeoff requires the signed takeoff acknowledgement; customer-supplied quantities follow their own recorded responsibility.

Use the active product catalog to add items. Review SKU, whole-bundle/package increments, quantities, and standard or cash-discount pricing. Import and activate the approved catalog before entering catalog quantities when no active version exists. **Product catalog** is available from the order workspace and **Settings → Workflows**. Authorized staff can maintain catalog data; verify the active version before using a rate.

## Approve, Take Payment, and Check Fulfillment {#ready}

Build and send the estimate, select the correct sales tax district, record required acknowledgement and customer payment, and enter the requested delivery or pickup date. Customer pickup also requires trailer dimensions and a received trailer photo. The readiness gates hold ordering until required information is recorded. These operational fields do not prove a Sage posting or bank reconciliation.

## Place and Confirm the Airlite Order {#airlite}

Create and link the Airlite purchase order, generate the Airlite order workbook, send the reviewed order, and record its release. Save the manufacturer's EPS confirmation number when it arrives. Record the vendor invoice number and its payment-release step separately. Mark the order complete only after the pickup or delivery actually occurs.

Authorized users can delete an unreleased workflow record with confirmation; the linked estimate and purchase order remain. Use the item's delete action to remove an incorrect catalog line, then recheck quantities and totals. Released orders require their applicable correction workflow.

## Compose Order Emails from the Job {#emails}

Use the stepper's email actions for price sheets, pickup or delivery estimates, invoice/payment instructions, manufacturer orders, pickup or delivery instructions, dock-time requests, missed-pickup notices, and carrier coordination. The template fills the available job, customer, quantities, PO, EPS number, dates, and warehouse details; resolve missing fields and verify recipients before sending.

Review and attach the actual price sheet, estimate, acknowledgement, invoice, or generated order form called for by the email. Template wording that says “attached” does not attach a file by itself. Sending uses the department's configured Workspace mailbox and records a send audit; customer emails also log a client contact in the job's interaction history and reset follow-up aging. Sending an email does not automatically record payment, release a PO, or complete the order.

Admins maintain wording and manufacturer/warehouse/dealer details in **Settings → Workflows → Nu-Tech emails**. The sending address, sender name, office phone, and hours come from **Settings → Company → Departments**. Use **Check sending mailbox** after saving those settings; the check sends no email.
