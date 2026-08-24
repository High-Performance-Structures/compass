Nu-Tech orders
===

The Nu-Tech module coordinates Fox Blocks sales and bracing rentals without
duplicating the existing Compass estimate, purchase-order, financial, and Drive
systems. The project workflow is available only to N-numbered projects at
`/dashboard/projects/[id]/nutech`; the department queue is at
`/dashboard/nutech`.

workflow
---

1. Choose the customer type and its published 2026 pricing folder. Standard
   pricing is the non-discounted sheet and is not described to customers as
   credit-card pricing. Cash-discount pricing applies to cash, wire, or check.
2. Record whether quantities came from the customer or a Nu-Tech staff takeoff.
   Customer-provided quantities do not require a takeoff acknowledgement. A
   staff takeoff must have a signed acknowledgement before the Airlite PO can be
   released.
3. Build the client estimate in the shared Compass estimate workspace. Nu-Tech
   acknowledgement forms remain estimate snapshots so later template changes do
   not alter an issued estimate.
4. Add Fox Blocks, panels, Web Boxes, and accessories from the active versioned
   catalog. Compass enforces manufacturer package increments and snapshots the
   applicable customer price and Airlite cost on each order line. Bracing rates
   remain on the current customer price sheet.
5. Create the vendor commitment in the shared Compass PO workspace, complete the
   manufacturer-required 2026 Airlite order form, and link that Compass PO to the
   Nu-Tech workflow. Compass copies the Airlite template into the project Drive
   folder, fills mapped legacy rows, and places products missing from the legacy
   form on a dedicated Compass Addendum tab. The form subtotal includes both.
6. Office staff can record the Airlite PO release once the applicable workflow
   gates pass. The linked Compass PO advances from draft/approved to sent.
7. Record the Airlite confirmation and vendor invoice. Office staff can release
   the vendor invoice after the PO release and invoice number are recorded.

data and permissions
---

`src/db/schema-nutech.ts` separates stable product identity, catalog versions,
versioned price records, order-line snapshots, and project workflow state.
Estimates and POs remain authoritative in their existing module tables.

The 2026 import reads all four published pricing workbooks and refuses the
import if their SKU sets, product attributes, costs, or product counts disagree.
The published tiers are stored exactly: new standard, new cash-discount,
returning standard, and returning cash-discount. A draft import must be
activated before new orders adopt it; an existing order retains the catalog
version it started with.

Each product has an optional foreign key to `sage_cost_codes`. Importing or
activating a Nu-Tech catalog never creates or changes a Sage cost code and never
guesses a mapping. Existing Sage codes can be selected deliberately. New or
never-sold products remain `unmapped` until the cost code exists in the Sage
read model, which keeps later Sage price/inventory integration additive instead
of coupling product identity to a mutable accounting description.

The `nutech-orders` permission feature uses the project resource. Internal office
roles therefore retain create/edit/release access as requested, while project
permission overrides can make the workflow read-only or hidden. Creating and
editing the workflow is paired with a permission-appropriate delete action;
deleting it does not delete the linked estimate or PO.

manufacturer-template boundary
---

The Airlite template still contains legacy 6-inch SKUs and does not contain rows
for panels, Web Boxes, or spray products. The catalog records the legacy aliases
and exact target rows rather than silently changing SKUs. New products appear
on the Compass Addendum worksheet, and the original order subtotal is replaced
with the full catalog-line cost total. Changing quantities marks a previously
generated workbook stale; PO release requires a fresh generated workbook.
