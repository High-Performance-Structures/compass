---
{
  "id": "nutech.orders",
  "featureId": "nutech-orders",
  "slug": "nutech-orders",
  "title": "Nu-Tech Sales and Order Process",
  "summary": "Move Nu-Tech jobs from sales intake through catalog quantities, estimating, bracing rental, payment, manufacturer ordering, and fulfillment.",
  "contextSummary": "The order stepper links to missing requirements. Verify the active catalog, quantities, estimate, acknowledgement, payment, bracing, delivery or pickup details, PO release, and manufacturer confirmation separately.",
  "category": "Project Operations",
  "tags": ["Nu-Tech", "Fox Blocks", "Airlite", "catalog", "price source", "bundles", "estimate", "manufacturer PO", "order form", "bracing rental", "sales", "delivery", "pickup", "takeoff", "EPS", "order emails"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/nutech", "/dashboard/nutech/catalog", "/dashboard/projects/[id]/nutech"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-12"
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

Use the active product catalog to add items. Review SKU, whole-bundle/package increments, quantities, and standard or cash-discount pricing. **Product catalog** shows the active version, effective and import dates, and the published price sheets and Airlite order form that supply the prices, costs, and SKUs.

To update pricing, change the approved sheets without changing their shared SKU structure, choose **Import 2026 catalog**, review the new draft, then **Activate** it. New order lines use the active prices; lines already saved on an order keep the price captured when they were added. Importing and activating require Nu-Tech approval access. A new year's source files require a Compass update rather than repointing the existing import silently.

For delivery, enter the **Shipping charge** and **Quote from** source. Choose the sales-tax district for the delivery address; pickups use the warehouse district when no other district is selected. Compass carries shipping into the estimate as a separate line using the Freight mapping and displays it as non-taxed in the order summary. Correct the Freight-to-Sage mapping on the price list if the estimate reports that it is missing.

After saving quantities, shipping, and the sales-tax district, use **Create estimate from order**. Compass fills the draft estimate from the order's products, shipping, and tax. If an existing draft already has lines, review the confirmation before replacing them; its text, terms, and acknowledgements remain. Open the resulting estimate and verify the customer prices, quantities, tax, and presentation before sending it.

## Approve, Take Payment, and Check Fulfillment {#ready}

Build and send the estimate, select the correct sales tax district, record required acknowledgement and customer payment, and enter the requested delivery or pickup date. Customer pickup also requires trailer dimensions and a received trailer photo. The readiness gates hold ordering until required information is recorded. These operational fields do not prove a Sage posting or bank reconciliation.

## Place and Confirm the Airlite Order {#airlite}

Choose **New Airlite PO** to build the manufacturer purchase order from the saved order and link it. Compass assigns the controlled manufacturer PO sequence and fills the current Airlite order form in the project's Drive folder. If a linked PO already exists, Compass opens it instead of making another one. Review the PO, generated workbook, project folder, quantities, costs, requested date, freight, tax treatment, and manufacturer form before sending or releasing it.

If the project has no linked Drive folder, use **Create Drive folder** on the project or purchase-order page before filling the order form. Compass creates the standard structure or relinks the existing matching folder. Retry that recovery action rather than making a second folder manually.

Record the Airlite PO release only after the exact form has been sent. Save the manufacturer's EPS confirmation number when it arrives. Record the vendor invoice number and its payment-release step separately. Mark the order complete only after the pickup or delivery actually occurs. A released order locks its manufacturer pricing, delivery date, linked PO, quantities, and workbook; use the authorized correction workflow rather than replacing its history.

Authorized users can delete an unreleased workflow record with confirmation; the linked estimate and purchase order remain. Use the item's delete action to remove an incorrect catalog line, then recheck quantities and totals. Released orders require their applicable correction workflow.

## Compose Order Emails from the Job {#emails}

Use the stepper's email actions for price sheets, pickup or delivery estimates, invoice/payment instructions, manufacturer orders, pickup or delivery instructions, dock-time requests, missed-pickup notices, and carrier coordination. The template fills the available job, customer, quantities, PO, EPS number, dates, and warehouse details; resolve missing fields and verify recipients before sending.

Review and attach the actual price sheet, estimate, acknowledgement, invoice, or generated order form called for by the email. Template wording that says “attached” does not attach a file by itself. Sending uses the department's configured Workspace mailbox and records a send audit; customer emails also log a client contact in the job's interaction history and reset follow-up aging. Sending an email does not automatically record payment, release a PO, or complete the order.

Admins maintain wording and manufacturer/warehouse/dealer details in **Settings → Workflows → Nu-Tech emails**. The sending address, sender name, office phone, and hours come from **Settings → Company → Departments**. Use **Check sending mailbox** after saving those settings; the check sends no email.

## Manage Bracing Rentals {#bracing-rentals}

For block-and-bracing or bracing-only work, record the planned rental dates and notes on the order, then use **Bracing rental** to create the actual reservation. Enter the signed-out and expected-return dates, equipment, sizes, quantities, deposit, ID-copy confirmation when required, and notes. Review the calculated braces, days, rent, deposit, and balance before choosing **Sign out**.

When equipment returns, enter the return date, quantities returned and damaged, damage charges and notes, and any authorized billed-day override, then choose **Check in**. A reserved rental can be deleted with confirmation; signed-out or returned history remains part of the job record. The Nu-Tech inventory board shows what is reserved, out, late, and available across jobs.

Admins maintain owned equipment by size, the item counted as a brace, daily rate, minimum deposit, and ID-copy rule under **Settings → Workflows → Bracing rentals**. A settings change affects new rentals; verify the rate copied onto an existing rental before billing.
