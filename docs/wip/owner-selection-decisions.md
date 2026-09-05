# Owner selections and decisions

Scope baseline: branch `codex/owner-selections`, based on `0c930870` on main. The approved request is to integrate the existing finish-selection form with owner decisions, pricing/alternative requests, supplier RFQs, and purchase orders while preserving dashboard controls and Quick Add.

## Behavior

- Staff decision rows expand on demand and support product/room search, keeping large project lists manageable.
- Staff maintain room/product specifications in the existing Finish Selections editor, then explicitly publish an owner revision with a deadline, allowance, total owner price, schedule impact, and optional owner change order.
- Owners see published specifications, request pricing or propose alternatives, edit or withdraw their own pending requests, and approve the displayed revision. Internal owner previews cannot submit decisions.
- Approval requires known pricing and timing, no pending request, and an executed owner change order when pricing differs from the allowance or staff mark a change order required. Approval records the actual owner, timestamp, and exact terms. It neither purchases goods nor replaces change-order approval.
- Product edits make a published specification stale. Republishing clears the current approval and retains prior approval history. Staff lifecycle statuses cannot manufacture an owner signature.
- Importing selections into a new supplier RFQ preserves source-selection links and specification snapshots atomically. Staff can link/unlink existing project purchase orders; links do not issue or authorize orders.
- Assigned partners see current published owner-approved specifications across the project; procurement links remain limited to RFQs and commitments already visible to them. Owner pricing, allowances, notes, requests, decision deadlines, timing terms, approval identities/timestamps, and approval history are excluded.
- Published, requested, linked, or previously owner-approved decisions are protected against selection deletion. Requests are withdrawn with confirmation and retained for audit; procurement unlinking also records an audit entry.

## Storage and release

Migration `0153_project_selection_decisions.sql` adds four tables: published decisions, owner requests, decision audit events, and procurement links. It does not backfill owner approvals from legacy staff status fields. Apply this migration before deploying the pages. Existing projects begin with unpublished choices until staff review and publish them. The dashboard reports unavailable counts if its optional selection reader fails.

The owner boundary is the selection decision lifecycle and its links to existing procurement. Existing change-order execution, RFQ responses, purchase-order issuance, accounting, and scheduling remain their respective workflows. Existing print/share packets remain staff tools; the staff page includes a direct owner-preview link.

## Verification contract

Integration tests exercise the actual actions against a transactional SQLite/D1 adapter and the new migration, including authorization, stale revisions, write races, failed audit rollback, change-order requirements, request ownership, RFQ link persistence, staff status changes, and partner data projection. Browser checks exercise the actual React components with isolated action boundaries: approval terms, request creation/edit/withdrawal, staff publication, filters, previews, empty states, and desktop/mobile layouts. The existing dashboard browser suite checks Quick Add, project switching, logout, photos and theme controls.

Local structured autoreview is required before shipping. The user explicitly waived the separate GitHub independent-review requirement and authorized squash merge and deployment.

Review corrections: owner approval preserves procurement/install lifecycle status; any owner request history protects the selection from deletion, including resolved and withdrawn requests. Focused regressions cover both cases.

Second review classification: supplier decision-metadata redaction is an in-scope exposure at the existing selection read boundary. It needs no new workflow, storage, or permission protocol; remove the fields and extend the supplier projection test.

## Publishing controls

Unpublished staff rows expose **Publish to owner** directly. The form opens with owner visibility selected, and publication still requires submitting the form. Pending and already-selected choices can both be shared without recording owner approval.

Staff can select multiple unpublished rows, use **Select all shown** within the current filters, and confirm **Publish selected to owner**. The confirmation includes selected items outside the current filter. Each item retains its displayed owner terms and uses the existing permission, draft timestamp, decision revision, and audit checks. Already-published items are excluded to avoid replacing approvals accidentally. Publication runs in small request groups with progress; successful items clear from the selection and errors remain selected with an explanation. Keep the page open until publishing finishes.

### Project-wide trade coordination and reports

Every assigned subcontractor/vendor can read current, published owner-approved specifications across the project. A procurement link is no longer required for technical visibility. Drafts, pending decisions and outdated specifications remain withheld; the general selections page does not present estimates as approved choices. RFQ import already carries selection specification details to the assigned bidder for pricing before approval. RFQ and PO links still appear only for procurement records the viewer can access.

Owner and partner selections support individual printouts, filtered packets and room sheets using the internal branded packet layout. Partner reports include technical specifications without owner financial terms, private notes or approval identity. Owners retain their published pricing and decision status. Printing does not approve or publish a selection.

Assigned RFQs, commitments/POs and RFIs have individual and combined reports. Change orders, warranty claims and the project directory also have report controls. Published owner updates expose their existing print layout; schedule and owner budget printing remain available. Reports are generated only from authorized workspace projections, without a staff data fetch or an additional access grant.
