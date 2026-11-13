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
  "lastReviewed": "2026-11-12"
}
---

## Prepare Rooms {#prepare-rooms}

Open project **Selections** and review the room list before adding products. Use room names matching the plans so owner reviews, RFQ scope, purchasing, and field room sheets refer to the same places.

## Add a Selection {#add-selection}

Choose **Add selection** at the top of the **Selections** sheet, next to the status buttons (or **Add** on a room under **Work on › Finish specs** to start with that room filled in). The form opens in a drawer on the right. Record the room, category, item, manufacturer, model, finish, supplier, quantity, product URL, division, cost code, status, visibility, and useful notes. **Room** is a drop-down list of the rooms already used on your company's jobs (this job's first); type to search, and if the room isn't there choose **Add “…”** to use what you typed. A product link supplements identifying details; web content can change.

## Choices, Links and Follow-ups {#choices}

The page shows one area at a time: choose it from **Work on** under the page header. **Selection sheet** (the default) holds the sheet, **Publish to owner** sets owner terms and publishes, **Finish specs** edits products room by room, and **Print & share** prints, copies and emails. The address keeps the area (`?work=`), so a link opens the same area.

The **Selections** sheet lists every selection with its room, cost code, number of choices, the owner's pick, how the pick compares with the allowance, the due date and status. Follow-up selections sit indented under the selection whose choice opens them. Use the status buttons and search to narrow the list, and click a row to open it in a drawer on the right, over the sheet. The page address then links to that selection, so you can share it. Close the drawer to go back to the sheet.

The arrows at the top of the drawer go to the previous and next selection in the sheet as it is filtered and sorted, without closing the drawer, and show where you are ("3 of 12"). To walk an owner through a Selection Phase, click its card above the sheet, open the first selection and step through with the arrows.

In the drawer:

- **Add choice** records an option's title, description, supplier, supplier price, owner price, lead time and status. The owner price is what the owner sees, including the builder fee; owners never see the supplier or the supplier price.
- Drag choices (or use the arrows) to set the order the owner sees.
- **Paste product link** adds a supplier's product page. Compass shows the page's name, picture and listed price when the page provides them, or a plain link when it doesn't.
- From a choice's menu, attach photos from the job, mark the owner's pick, or choose the **Follow-up selections** that picking it opens (a vanity opens its hardware and top). Selection photos (choice pictures) show only here in Selections; they stay out of the job's Photos, client updates and dashboards.
- **Ask supplier to price** puts the chosen options on a normal RFQ draft, new or added to an unsent draft. Send it from **RFQs** as usual; the prices the supplier enters through the price link, or that you record by hand, fill in the choices' supplier prices.
- **To-dos** lists the to-dos linked to the selection. Compass adds "Price choices for…" when an unpriced choice is added, "Order…" when the owner signs the Selection Phase, and "Answer owner question on…" when the owner comments. Mark them done on **To-dos** when the work is finished.
- **Comments** can be owner-visible or, with **Staff only** ticked, internal.

Records imported from another system show a small source tag.

**Selection Phases.** Cards above the sheet show each of the company's Selection Phases on this job: the due date (from the job's schedule), how many selections have the owner's pick, and how far the picks are over or under the allowance. Click a card to show only that Selection Phase's selections; **No Selection Phase** shows the rest. Put a selection in a Selection Phase from its drawer. When every selection in a Selection Phase has the owner's pick, project staff get a "ready to finalize" notification once; if a pick is cleared, the next completion notifies again. (Selection Phases are separate from Sage phase codes, phase estimates and schedule phases.)

**Picking for the owner and signing a Selection Phase.** When the owner tells you their choice, use **Mark as owner's pick** on the choice and add a note such as "per phone call"; the panel and the printed Selection Phase show who picked it and when. When every selection in a Selection Phase has a pick, its card shows **Print Selection Phase** (Print Preview of the Selection Phase document: each item's room, photo, choice, supplier link, owner price and over/under the allowance, the Selection Phase total and a signature page) and **Send for signature**. Sending lets you choose the owners to sign from the job's owner contacts, makes the change order (fixed price, or cost plus above the Settings threshold) or variance for the difference, puts it in the same document, and opens Foxit to review and send; Foxit emails the owners. When they sign, the Selection Phase's selections become Approved (signed), staff get an "Order…" to-do for each, the change order is executed (or the variance approved), the signed PDF is saved to the job's Drive folder under Selections, and staff are notified. Once a selection is approved (signed, or approved in Buildertrend) its pick can't change, for staff or the owner: "This selection is approved. Use a change order to change it." Nor can any pick in a Selection Phase that is out for signature ("This selection is out for signature."). Editing, publishing or re-importing never clears an owner approval (signed or imported): staff get a "Review change order impact" to-do instead, and an approved pick's price can't be edited. A price can still change while a Selection Phase is out for signature, but the job's members in the roles chosen in Settings are notified with the product, the old and new price, and that it is out for signature. Earlier signed documents stay listed with the Selection Phase.

**Choice templates.** Reuse a set of choices on any job. In a selection's drawer, **Save as template** saves its choices (prices, suppliers, lead times, product links), and **Apply template** adds a template's choices to it. **Choice templates** above the sheet lists the company's templates, applies one to every selection on the job in the template's category, deletes them, and imports templates from a CSV file. The CSV has one row per choice, with the columns Template, Category, Title, Description, Supplier, Supplier price, Owner price, Lead time days and Product URL; Template and Title are required. Supplier names that match a vendor link to it, and importing a template name that already exists replaces that template.

Admins set the company defaults in **Settings › Workflows › Selections**: the Selection Phases and the schedule item that sets each Selection Phase's due date, default lead times by category (new choices start with them), the owner-price markup (a blank owner price is filled in from the supplier price, including prices returned on an RFQ; staff can change it), and the over-budget percent at which a variance is handled as a change order.

## Owner Choosing {#owner-choosing}

Once a selection is published, the owner sees its choices as photo cards with the owner price, how far over or under the allowance each one is, and a link to the supplier's page. The owner taps a card to pick it and can change their pick until they confirm their choice or the selection is ordered. When the owner presses **Confirm my choice** on a published decision, Compass records it as the **Owner's choice** (with their name and time, in the history and Activity). That is a preference, not an approval: the status, prices, budget, variances and change orders change only when the owner signs the Selection Phase. Owners can **Suggest an item (paste a link)** and **Ask a question**; their questions appear in the selection's comments.

## Divisions and Cost Codes {#divisions-cost-codes}

Choose the division first to narrow cost codes. If a valid project code is marked for Sage review, flag it rather than choosing an incorrect accounting code simply to remove the warning.

## Status and Approval {#status-approval}

Status should describe the current business state: Needed, Proposed, With owner, Approved, Pricing, RFQ sent, Ordered, Installed, Unavailable or Deferred. Change it from the dropdown at the top of a selection's drawer. Compass also moves it forward on its own, and never backward: publishing it to the owner makes it With owner, sending its purchase order makes it Ordered, and ticking it under **Selections installed** on a daily log makes it Installed. Each automatic move is listed in Activity. Owner visibility and approval are separate from internal drafting. A selection the owner signed for in a Selection Phase shows **Approved (signed)**; one set to Approved by hand shows plain **Approved**. The owner's click records the **Owner's choice** and never waits for a change order: the signature carries the price difference.

**Ordered and installed selections are locked.** An installed selection's status, pick and product can't change, by staff or by Compass; an ordered one can only move on to Installed, or to Unavailable when the supplier can't fill it. That lets go of its purchase order (kept on record); its drawer offers **Replace with a new selection** (supplier couldn't fill). A change of mind uses **Owner changed selection after purchase** instead. Neither can be deleted, reopened, republished or added to a Selection Phase (staff can take one out of its phase); an ordered one keeps its product, cost code and phase, and an installed one changes only its notes. A Selection Phase's document, progress and change order leave out replaced selections, approvals no signature covers (such as Buildertrend imports) and ordered or installed selections with no pick, so nothing is billed twice; an ordered or installed selection with an unsigned pick stays in and is billed. When an installed item must be replaced with a different product, use **Replace installed item** in its drawer and choose the replacement from its choices (add it as a choice first if needed). When the owner changes their mind after a selection was ordered, use **Owner changed selection after purchase**. An approved selection that isn't ordered yet offers **Owner changed selection after approval** the same way. Either way the original selection stays on record as it was, and a new selection replaces it (copies of the choices, the new pick if chosen, hidden from the owner until you publish it). Compass doesn't write a change order for it: the job's project manager (or, without one, the next role chosen in Settings, else the company's administrator) gets a to-do, shown on both selections, to write the change order on the change-order screens and send it for the owner's signature. If that to-do is missing, the replacement's drawer offers **Create change-order to-do**; deleting a replacement archives its open to-do. Once it is signed, set the replacement's status. A selection can't be replaced while its Selection Phase is out for signature. The replaced selection is read-only (no choice, link or photo changes) and drops off the daily log's **Selections installed** list; a replacement stays out of Selection Phases (its change order bills it). While a Selection Phase is out for signature, its choices change only in price (the managers are told) and nothing in it can be deleted. Admins choose in **Settings › Workflows › Selections** whether owners can confirm their choice by click, and which project roles hear about a price change during a signature (the first of them on the job also gets a replacement's change-order to-do) (by default project managers, assistant project managers and project administrators).

## Change an Approved Selection {#approved-change}

Approved selections may change when products or conditions change, but not silently. Record the reason and notify responsible staff when cost, schedule, procurement, contract documents, or installation is affected. The change may require a revised RFQ, P.O., owner decision, task, or change order.

Delete only an unneeded record when authorized and after reviewing dependencies. Preserve approval history for consequential decisions.

## Filter and Share {#filter-share}

**Publish to owner**, **Finish specs** and **Print & share** share one filter bar: search, room, division and cost code. Rooms start folded to one line with the item count and status ("3 waiting on owner", "all chosen" or "all approved", late risk); open one, or use **Expand all** / **Collapse all**. In **Publish to owner**, tick selections to publish several together, or click one to open its terms, publish form, links and history in a drawer on the right.

In **Print & share**, choose **Organize by** **Room** or **Category**, then the print style: **Packet** (one document) or **Room sheets** / **Category sheets** (each room or category starts on its own page; category sheets suit trades, and each item names its room). **Print Preview** opens the filtered printout in a new tab with **Print / Save PDF**, and **Copy sheet** copies a spreadsheet in the same order. Review the filtered result before printing, copying, or sharing.

## Quick Check {#quick-check}

- [ ] Room and product details match the plans and decision.
- [ ] Division and cost code are correct.
- [ ] Approval and owner visibility reflect the current state.
- [ ] Approved changes include a reason and operational follow-up.
