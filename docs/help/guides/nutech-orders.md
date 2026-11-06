---
{
  "id": "nutech.orders",
  "featureId": "nutech-orders",
  "slug": "nutech-orders",
  "title": "Nu-Tech Sales and Order Process",
  "summary": "Move Nu-Tech jobs from sales intake through catalog quantities, approval, payment, Airlite ordering, and fulfillment.",
  "contextSummary": "The order stepper links to missing requirements. Verify quantities, acknowledgement, payment, delivery or pickup details, PO release, and manufacturer confirmation separately.",
  "category": "Project Operations",
  "tags": ["Nu-Tech", "order board", "needs attention", "Fox Blocks", "Airlite", "catalog", "bundles", "truckload", "sales", "delivery", "pickup", "confirmed date", "carrier", "dock time", "takeoff", "EPS", "order emails"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/nutech", "/dashboard/nutech/catalog", "/dashboard/nutech/truckload", "/dashboard/projects/[id]/nutech"],
  "owner": "Compass product team",
  "lastReviewed": "2026-11-06"
}
---

## Work the Order Board {#board}

**Nu-Tech Orders** lists every order on every N job, one row per order, sorted by requested pickup or delivery date. Sort by any column, search by job, customer, confirmation number, carrier or invoice number, and click a row to open that order on its job.

The **Needs attention** boxes at the top count the orders someone has to chase. Choose a box to see only its orders; choose it again, or **Show all orders**, to go back.

- **Ships soon**: pickup or delivery within the next few days, by the confirmed date once there is one, otherwise the requested date. An unpaid order shows **Not paid** in the Customer paid column.
- **Approved, not paid**: the customer approved, and no payment is recorded.
- **PO sent, manufacturer hasn't confirmed**: the PO went out and no confirmation number has been saved.
- **Confirmed, no pickup or delivery date**: the manufacturer confirmed the order, but its confirmed date isn't recorded and the requested date hasn't passed.
- **Past pickup or delivery, no invoice**: the order is confirmed, its date has passed, and no vendor invoice is recorded.

When the manufacturer confirms, record the confirmation number, the **Confirmed pickup / delivery** date, the **Time or dock window** (for example "dock time 2:00 PM"), and the **Carrier** in section 4 of the order. Carriers typed on earlier orders are suggested. The confirmed date shows in the board's **Confirmed date** column and in the order's next step.

The **Next step** column says what to do for each order. Admins set how many days each box waits in **Settings → Workflows → Nu-Tech order board**. Whether Nu-Tech's own bills to the manufacturer are paid is tracked in Sage, not on the board.

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

Under the product list, **Truck** shows about how much of a full manufacturer truckload the order takes, for example "About 81% of a full truckload." Each product's bundles are divided by the bundles of that product that fill a truck, and the results are added together; a part bundle counts as a whole one. Set **Bundles / truck** for each block on the **Product catalog**. A block without it is listed as not counted. Importing a new price list keeps these numbers.

For what-ifs before an order exists, open **Office Tools → Truckload Calculator**. Type bundles for each block to see the share of a truck and how much room is left. Nothing on that page is saved.

## Approve, Take Payment, and Check Fulfillment {#ready}

Build and send the estimate, select the correct sales tax district, record required acknowledgement and customer payment, and enter the requested delivery or pickup date. Customer pickup also requires trailer dimensions and a received trailer photo. The readiness gates hold ordering until required information is recorded. These operational fields do not prove a Sage posting or bank reconciliation.

## Place and Confirm the Airlite Order {#airlite}

Create and link the Airlite purchase order, generate the Airlite order workbook, send the reviewed order, and record its release. Save the manufacturer's EPS confirmation number when it arrives. Record the vendor invoice number and its payment-release step separately. Mark the order complete only after the pickup or delivery actually occurs.

Authorized users can delete an unreleased workflow record with confirmation; the linked estimate and purchase order remain. Use the item's delete action to remove an incorrect catalog line, then recheck quantities and totals. Released orders require their applicable correction workflow.

## Compose Order Emails from the Job {#emails}

Use the stepper's email actions for price sheets, pickup or delivery estimates, invoice/payment instructions, manufacturer orders, pickup or delivery instructions, dock-time requests, missed-pickup notices, and carrier coordination. The template fills the available job, customer, quantities, PO, EPS number, dates, and warehouse details; resolve missing fields and verify recipients before sending.

Review and attach the actual price sheet, estimate, acknowledgement, invoice, or generated order form called for by the email. Template wording that says “attached” does not attach a file by itself. Choose **To** and **Cc** from the job's contacts or type an address. Sending uses the department's configured Workspace mailbox and is recorded in the **Activity** log; customer emails also log a client contact in the job's interaction history and reset follow-up aging. Replies go to the Nu-Tech mailbox and back to the job in Compass: the team is notified, and a customer's reply is logged as client contact. Sending an email does not automatically record payment, release a PO, or complete the order.

Admins maintain wording and manufacturer/warehouse/dealer details in **Settings → Workflows → Nu-Tech emails**. The sending address, sender name, office phone, and hours come from **Settings → Company → Departments**. Use **Check sending mailbox** after saving those settings; the check sends no email.
