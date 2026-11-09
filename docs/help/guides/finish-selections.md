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
