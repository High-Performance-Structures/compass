---
{
  "id": "selections",
  "featureId": "finish-selections",
  "slug": "finish-selections",
  "title": "Finish Selections and Change Tracking",
  "summary": "Organize finish selections by room, cost code, status, approval, and change history.",
  "contextSummary": "Selections turn owner decisions into usable estimating, purchasing, and field information. Approved changes need a reason and follow-up trail.",
  "category": "Client Communication",
  "tags": ["finish selections", "rooms", "cost codes", "approvals", "RFQ", "products"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/projects/[id]/selections"],
  "owner": "Project operations",
  "lastReviewed": "2026-11-09"
}
---

## Prepare Rooms {#prepare-rooms}

Open project **Selections** and review the room list before adding products. Use room names matching the plans so owner reviews, RFQ scope, purchasing, and field room sheets refer to the same places.

## Add a Selection {#add-selection}

Open the room, add a selection, and record category, item, manufacturer, model, finish, supplier, quantity, product URL, division, cost code, status, visibility, and useful notes. A product link supplements identifying details; web content can change.

## Choices, Links and Follow-ups {#choices}

The **Selections** sheet at the top of the page lists every selection with its room, cost code, number of choices, the owner's pick, how the pick compares with the allowance, the due date and status. Follow-up selections sit indented under the selection whose choice opens them. Use the status buttons and search to narrow the list, and click a row to open its detail panel.

In the detail panel:

- **Add choice** records an option's title, description, supplier, supplier price, owner price, lead time and status. The owner price is what the owner sees, including the builder fee; owners never see the supplier or the supplier price.
- Drag choices (or use the arrows) to set the order the owner sees.
- **Paste product link** adds a supplier's product page. Compass shows the page's name, picture and listed price when the page provides them, or a plain link when it doesn't.
- From a choice's menu, attach photos from the job, mark the owner's pick, or choose the **Follow-up selections** that picking it opens (a vanity opens its hardware and top).
- **Ask supplier to price** puts the chosen options on a normal RFQ draft, new or added to an unsent draft. Send it from **RFQs** as usual; the prices the supplier enters through the price link, or that you record by hand, fill in the choices' supplier prices.
- **To-dos** lists the to-dos linked to the selection. Compass adds "Price choices for…" when an unpriced choice is added, "Order…" when the owner approves, and "Answer owner question on…" when the owner comments. Mark them done on **To-dos** when the work is finished.
- **Comments** can be owner-visible or, with **Staff only** ticked, internal.

Records imported from another system show a small source tag.

**Rounds.** Cards above the sheet show each of the company's selection rounds on this job: the due date (from the job's schedule), how many selections have the owner's pick, and how far the picks are over or under the allowance. Click a card to show only that round's selections; **No round** shows the rest. Put a selection in a round from its detail panel. When every selection in a round has the owner's pick, project staff get a "ready to finalize" notification once; if a pick is cleared, the next completion notifies again.

**Picking for the owner and signing a round.** When the owner tells you their choice, use **Mark as owner's pick** on the choice and add a note such as "per phone call"; the panel and the printed round show who picked it and when. When every selection in a round has a pick, its card shows **Print round** (Print Preview of the round document: each item's room, photo, choice, supplier link, owner price and over/under the allowance, the round total and a signature page) and **Send for signature**. Sending lets you choose the owners to sign from the job's owner contacts, makes the change order (fixed price, or cost plus above the Settings threshold) or variance for the difference, puts it in the same document, and opens Foxit to review and send; Foxit emails the owners. When they sign, the round's selections become Approved, the change order is executed (or the variance approved), the signed PDF is saved to the job's Drive folder under Selections, and staff are notified. Changing a signed pick reopens only that selection; send the round again to sign the change. Earlier signed documents stay listed with the round.

**Choice templates.** Reuse a set of choices on any job. In a selection's detail panel, **Save as template** saves its choices (prices, suppliers, lead times, product links), and **Apply template** adds a template's choices to it. **Choice templates** above the sheet lists the company's templates, applies one to every selection on the job in the template's category, deletes them, and imports templates from a CSV file. The CSV has one row per choice, with the columns Template, Category, Title, Description, Supplier, Supplier price, Owner price, Lead time days and Product URL; Template and Title are required. Supplier names that match a vendor link to it, and importing a template name that already exists replaces that template.

Admins set the company defaults in **Settings › Workflows › Selections**: the selection rounds and the schedule item that sets each round's due date, default lead times by category (new choices start with them), the owner-price markup (a blank owner price is filled in from the supplier price, including prices returned on an RFQ; staff can change it), and the over-budget percent at which a variance is handled as a change order.

## Owner Choosing {#owner-choosing}

Once a selection is published, the owner sees its choices as photo cards with the owner price, how far over or under the allowance each one is, and a link to the supplier's page. The owner taps a card to pick it and can change their pick until the selection is approved. Owners can **Suggest an item (paste a link)** and **Ask a question**; their questions appear in the selection's comments.

## Divisions and Cost Codes {#divisions-cost-codes}

Choose the division first to narrow cost codes. If a valid project code is marked for Sage review, flag it rather than choosing an incorrect accounting code simply to remove the warning.

## Status and Approval {#status-approval}

Status should describe the current business state: needed, proposed, owner review, approved, pricing requested, ordered, or unavailable. Owner visibility and approval are separate from internal drafting.

## Change an Approved Selection {#approved-change}

Approved selections may change when products or conditions change, but not silently. Record the reason and notify responsible staff when cost, schedule, procurement, contract documents, or installation is affected. The change may require a revised RFQ, P.O., owner decision, task, or change order.

Delete only an unneeded record when authorized and after reviewing dependencies. Preserve approval history for consequential decisions.

## Filter and Share {#filter-share}

Filter by room, division, cost code, or status for owner review, room sheets, RFQ scope, or a project packet. Review the filtered result before printing, copying, or sharing. Choose **Packet** or **Room sheets**, then **Print Preview** opens the filtered packet in a new tab with **Print / Save PDF**.

## Quick Check {#quick-check}

- [ ] Room and product details match the plans and decision.
- [ ] Division and cost code are correct.
- [ ] Approval and owner visibility reflect the current state.
- [ ] Approved changes include a reason and operational follow-up.
