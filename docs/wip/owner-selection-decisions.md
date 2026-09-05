# Owner selections and decisions

Scope baseline: branch `codex/owner-selections`, based on `0c930870` on main. The approved request is to integrate the existing finish-selection form with owner decisions, pricing/alternative requests, supplier RFQs, and purchase orders while preserving dashboard controls and Quick Add.

## Behavior

- Staff maintain room/product specifications in the existing Finish Selections editor, then explicitly publish an owner revision with a deadline, allowance, total owner price, schedule impact, and optional owner change order.
- Owners see published specifications, request pricing or propose alternatives, edit or withdraw their own pending requests, and approve the displayed revision. Internal owner previews cannot submit decisions.
- Approval requires known pricing and timing, no pending request, and an executed owner change order when pricing differs from the allowance or staff mark a change order required. Approval records the actual owner, timestamp, and exact terms. It neither purchases goods nor replaces change-order approval.
- Product edits make a published specification stale. Republishing clears the current approval and retains prior approval history. Staff lifecycle statuses cannot manufacture an owner signature.
- Importing selections into a new supplier RFQ preserves source-selection links and specification snapshots atomically. Staff can link/unlink existing project purchase orders; links do not issue or authorize orders.
- Partners see current approved specifications only through RFQs or commitments already visible to them. Owner pricing, allowances, notes, requests and approval history are excluded.
- Published, requested, linked, or previously owner-approved decisions are protected against selection deletion. Requests are withdrawn with confirmation and retained for audit; procurement unlinking also records an audit entry.

## Storage and release

Migration `0153_project_selection_decisions.sql` adds four tables: published decisions, owner requests, decision audit events, and procurement links. It does not backfill owner approvals from legacy staff status fields. Apply this migration before deploying the pages. Existing projects begin with unpublished choices until staff review and publish them. The dashboard reports unavailable counts if its optional selection reader fails.

The owner boundary is the selection decision lifecycle and its links to existing procurement. Existing change-order execution, RFQ responses, purchase-order issuance, accounting, and scheduling remain their respective workflows. Existing print/share packets remain staff tools; the staff page includes a direct owner-preview link.

## Verification contract

Integration tests exercise the actual actions against a transactional SQLite/D1 adapter and the new migration, including authorization, stale revisions, write races, failed audit rollback, change-order requirements, request ownership, RFQ link persistence, staff status changes, and partner data projection. Browser checks exercise the actual React components with isolated action boundaries: approval terms, request creation/edit/withdrawal, staff publication, filters, previews, empty states, and desktop/mobile layouts. The existing dashboard browser suite checks Quick Add, project switching, logout, photos and theme controls.

Local structured autoreview is required before shipping. The user explicitly waived the separate GitHub independent-review requirement and authorized squash merge and deployment.
