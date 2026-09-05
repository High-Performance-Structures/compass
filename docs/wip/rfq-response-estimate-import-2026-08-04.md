# RFQ response, bid comparison, and estimate import

Status: first production workflow implemented September 2026; the normalized
multi-recipient/revision model below remains the longer-term hardening plan.

## Implemented first increment

- Staff can duplicate an RFQ scope and document package into a separate draft
  for each vendor or subcontractor. Each copy has its own recipient email and
  remains within the existing recipient-scoped portal authorization boundary.
- Vendors can enter a price and note for every requested scope row, then submit
  a total response from their Compass sub/vendor workspace. Legacy RFQs without
  scope rows retain the single-total response form.
- Staff with RFQ approval permission can explicitly approve a submitted quote.
  Approval writes an immutable snapshot using integer cents and moves that
  bidder copy to `awarded`.
- An approved bid can be imported once into a draft or internal-review estimate.
  Each priced scope row becomes a new, traceable estimate line. New lines begin
  with zero markup, zero tax, builder-fee exclusion, and internal-only visibility
  so estimating staff must review coding and presentation choices.
- Approval, import-batch, and imported-line provenance are additive records in
  `project_rfq_bid_approvals`, `project_estimate_rfq_bid_imports`, and
  `project_estimate_rfq_bid_import_lines`.

The current increment intentionally models one confidential RFQ copy per bidder,
matching the requested duplication workflow and the existing portal security
model. A later phase may consolidate those copies under normalized revisions and
recipient records for a single comparison matrix.

## Outcome

A subcontractor prices each requested RFQ line without seeing another bidder's
response. Submitted bids become immutable snapshots. Internal staff compare
responses, explicitly approve the selected line or lines, and then explicitly
import the approved costs into an editable project estimate. The estimate keeps
working normally while an append-only audit trail preserves exactly which bid
values were selected and imported.

## Current Compass baseline

- An RFQ is a `project_operations` row with `source_record_type = 'rfq'`.
- Requested scope lines and document links are stored inside
  `project_operations.sage_payload_json`.
- The row holds one requested company/name and one recipient email.
- Staff can create, edit, delete, print, email, and manually change RFQ status.
- Finish selections may point to an RFQ through
  `project_finish_selections.rfq_operation_id`.
- Project estimates and estimate lines are first-class records. Accepted
  estimates are locked, and contract budgets retain accepted-estimate revision
  history.
- The subcontractor workspace does not have a recipient-scoped RFQ response
  workflow.

## Gaps and risks

1. JSON scope lines have no stable row IDs to which submitted prices can bind.
2. There is no RFQ revision snapshot. Editing a sent RFQ could otherwise change
   the apparent request after a subcontractor priced it.
3. There is no recipient/delivery record, viewed state, decline response, or
   authorization boundary for one invited bidder.
4. There is no per-line quantity, unit price, total, alternate, exclusion, or
   subcontractor note capture.
5. There is no immutable submission or submission revision history.
6. There is no bid comparison or explicit award/selection record.
7. RFQ status can currently be set to `awarded` without selection evidence.
8. Estimate lines do not record bid-source provenance, and there is no approved
   import action.
9. RFQs can currently be edited or deleted after sending; future behavior must
   restrict deletion to unused drafts and use revisions/void events afterward.
10. External project operations are not yet sufficiently recipient-scoped for
    confidential bid data. Bid responses and comparisons must never be returned
    through the general subcontractor operation query.

## Required invariants

- Currency is stored as integer cents, never floating point.
- Sending creates an immutable RFQ revision and immutable requested-line
  snapshot. Later RFQ edits create another revision.
- A recipient can access only revisions explicitly sent to that recipient.
- A recipient can never read another recipient's draft, submission, price, or
  comparison result.
- A submitted response is never updated or deleted. A correction creates a new
  submission revision; events explain withdrawal or supersession.
- Staff selection is an explicit approval action, not a side effect of changing
  an RFQ status or clicking a comparison cell.
- Only an approved selection can be imported into an estimate.
- Import is allowed only into an editable estimate (`draft` or
  `internal_review`), never an accepted or signature-pending estimate.
- Import and its provenance record are written transactionally.
- Importing does not apply markup, tax, or owner visibility silently. Existing
  target-line settings remain unchanged; new lines require staff review.
- RFQ, submission, approval, and import activity is append-only and attributable
  to an authenticated actor or recipient.

## Proposed data model

Keep `project_operations` as the RFQ header during the first implementation so
existing lists, statuses, printing, Sage metadata, and template-created RFQs
continue to work. Add normalized RFQ workflow tables.

### `project_rfq_revisions`

Immutable published request snapshot.

- `id`, `project_id`, `rfq_operation_id`
- `revision_number`, `title`, `scope`, `vendor_category`, `response_due_at`
- `source_hash`, `published_by`, `published_at`
- unique: `(rfq_operation_id, revision_number)` and
  `(rfq_operation_id, source_hash)`

### `project_rfq_revision_lines`

Stable requested lines for one published revision.

- `id`, `project_id`, `rfq_revision_id`, `line_number`
- `description`, `phase_code`, `cost_code`, `quantity`, `unit`, `notes`
- unique: `(rfq_revision_id, line_number)`

### `project_rfq_revision_documents`

Snapshot of document references supplied with that revision.

- `id`, `project_id`, `rfq_revision_id`, `line_number`
- `label`, `drive_file_id`, `drive_url`, `source_hash`, `notes`

### `project_rfq_recipients`

One delivery/authorization boundary per subcontractor estimator and revision.

- `id`, `project_id`, `rfq_revision_id`
- `project_contact_id`, nullable `user_id`, recipient email snapshot
- `access_token_hash`, `access_expires_at` for invitation fallback
- `sent_at`, `viewed_at`, `declined_at`, `decline_reason`
- `status` (`pending`, `sent`, `viewed`, `drafting`, `submitted`, `declined`)
- unique: `(rfq_revision_id, project_contact_id)`

Prefer authenticated project membership. Store only a hash for a fallback
invitation token, and expire/revoke it when access is accepted or the RFQ closes.

### `project_rfq_response_drafts` and draft lines

Mutable autosave workspace scoped to one recipient/revision. Draft data is never
used for comparison or estimate import.

- header: `id`, `recipient_id`, `notes`, `updated_by`, `updated_at`, `version`
- lines: requested-line ID, quantity, unit, unit price cents, total cents,
  alternate flag, exclusion flag, and line note

Optimistic `version` checks prevent one device from overwriting another.

### `project_rfq_submissions`

Immutable submitted header snapshot.

- `id`, `project_id`, `rfq_revision_id`, `recipient_id`
- `submission_number`, `total_cents`, `notes`, `submission_hash`
- `submitted_by_user_id`, submitter name/company/email snapshots
- `submitted_at`
- unique: `(recipient_id, submission_number)` and `submission_hash`

### `project_rfq_submission_lines`

Immutable response lines.

- `id`, `submission_id`, `rfq_revision_line_id`, `line_number`
- request description/cost-code snapshots
- `quantity`, `unit`, `unit_price_cents`, `line_total_cents`
- `is_alternate`, `is_excluded`, `notes`
- unique: `(submission_id, rfq_revision_line_id)`

### `project_rfq_submission_documents`

Immutable links to submitted proposals, clarifications, or supporting files.
Store Drive identifiers/URLs plus content metadata and a hash when available.

### `project_rfq_events`

Append-only event history for published, sent, viewed, draft saved, submitted,
declined, superseded, selection approved/voided, and imported events. Include
actor/recipient snapshots, event metadata JSON, and timestamp.

### `project_rfq_selection_decisions` and decision lines

An immutable internal approval envelope. One decision may choose all lines from
one submission or mix lines from multiple submissions.

- header: `id`, `project_id`, `rfq_operation_id`, `decision_number`
- `approval_note`, `approved_by`, `approved_at`
- lines: `rfq_revision_line_id`, `submission_line_id`, selected cost snapshot
- unique: `(decision_id, rfq_revision_line_id)`

The decision itself is never updated. Voiding writes an append-only event and,
when needed, a replacement decision. The currently effective decision is
derived from those records rather than stored by rewriting the original.

### `project_estimate_bid_imports`

Append-only bridge from approved bid selection to a working estimate.

- `id`, `project_id`, `estimate_id`, `estimate_line_id`
- `selection_decision_id`, `selection_decision_line_id`
- `submission_id`, `submission_line_id`
- `import_mode` (`new_line`, `replace_cost`, `add_cost`)
- `prior_unit_cost_cents`, `imported_unit_cost_cents`,
  `resulting_unit_cost_cents`
- quantity/unit/cost-code/description snapshots
- `imported_by`, `imported_at`, `import_batch_id`
- unique idempotency key for `(import_batch_id, selection_decision_line_id)`

The estimate line remains editable. This bridge preserves what was imported even
if staff later changes the working estimate.

## Proposed data flow

1. **Draft RFQ** — staff builds scope lines from templates, finish selections,
   schedule items, estimate/budget lines, or manual entry.
2. **Publish revision** — Compass snapshots header, requested lines, and document
   references and calculates a source hash.
3. **Choose recipients and send** — each estimator gets a recipient record and
   recipient-scoped workspace link. Status becomes `sent` only after delivery is
   recorded.
4. **Enter response** — subcontractor enters quantity, unit price, and/or total
   for each requested line; may mark an alternate or exclusion and attach a
   proposal. Draft autosaves are private.
5. **Submit** — one transaction validates all lines, calculates totals server
   side, writes immutable submission snapshots and an event, and marks the
   recipient submitted. Corrections create a new submission number.
6. **Compare** — internal-only matrix shows requested lines as rows and current
   submissions as columns, including alternates, exclusions, attachments, and
   prior submission revisions.
7. **Approve selection** — authorized staff chooses a response per requested
   line, enters an approval note, and confirms. The transaction writes an
   immutable decision and lines; only then may the RFQ become `awarded`.
8. **Import into estimate** — staff chooses an editable estimate and maps each
   selected line to an existing estimate line or a new line. Compass previews
   before/after costs, markup, tax, and total impact.
9. **Confirm import** — one transaction writes estimate changes and immutable
   `project_estimate_bid_imports` records, recalculates estimate totals, and
   appends RFQ/estimate activity events.

## Server actions and authorization

Suggested actions, all using server-side project/recipient authorization:

- `publishProjectRfqRevision`
- `sendProjectRfqRevision`
- `getRecipientRfqWorkspace`
- `saveRecipientRfqDraft`
- `submitRecipientRfqResponse`
- `declineRecipientRfq`
- `getProjectRfqComparison` (internal only)
- `approveProjectRfqSelection` (explicit RFQ approval permission)
- `voidProjectRfqSelection` (explicit reason required)
- `previewRfqSelectionEstimateImport`
- `importApprovedRfqSelectionToEstimate`

Approval must use the RFQ feature's `approve` access level rather than ordinary
RFQ edit access. Recipient submit/decline actions use a dedicated recipient
capability check; they must not grant general project-update permission to an
external user.

Editing/deletion policy:

- Unsent draft RFQ: editable and deletable.
- Published/sent RFQ: immutable revision; edits create a new revision.
- Draft response: editable and deletable by its recipient.
- Submitted response: immutable; corrections create a new submission.
- Approved decision/import record: immutable; reversal requires an explicit
  void/replacement event or an estimate revision.

## Migration plan

Use additive migrations; do not remove the current RFQ JSON fields during the
first release.

1. Add revision, revision-line, revision-document, recipient, and RFQ-event
   tables. Add draft-only edit/delete guards before exposing recipient links.
2. Backfill current RFQ JSON into `legacy` revision snapshots with
   `review_status = 'needs_review'`. Do not infer recipients or delivery from an
   RFQ header's company/email/status; staff must confirm those facts.
3. Add response draft, immutable submission, submission-line, and submission-
   document tables and the recipient workspace.
4. Add immutable selection-decision tables and RFQ `approve` enforcement.
5. Add estimate-import provenance and idempotency tables/actions.

During compatibility mode, RFQ reads prefer normalized current revisions and
fall back to existing JSON only for unreviewed legacy records. New sends must
always use normalized revisions.

## Estimate import rules

- Require active Sage cost-code mapping before creating a new estimate line.
- Default mapping suggestion is cost code plus description; never auto-merge
  solely because cost codes match.
- `replace_cost` changes the target line's unit/direct cost but preserves its
  markup rate, tax entity, taxable flag, specifications, and owner visibility.
- `new_line` copies the selected quantity, unit, description, and cost code;
  staff must confirm markup, tax, and owner visibility in the preview.
- Recalculate all estimate totals server side. Client totals are advisory only.
- Re-importing the same approved line requires an explicit new import batch and
  warning; the idempotency key blocks accidental double-click duplication.

## Delivery sequence

1. Normalize RFQ revisions/lines/documents and restrict post-send edit/delete.
2. Add recipient delivery and confidential subcontractor response workspace.
3. Add immutable submissions, revisions, attachments, and events.
4. Add internal comparison and explicit selection approval.
5. Add estimate import preview, transactional import, and provenance display.
6. Add regression/security coverage before enabling external submissions.

## Release gates

- A subcontractor cannot enumerate or fetch another recipient or submission.
- Changing a draft RFQ after send cannot alter a published revision.
- Submitted line values cannot be updated or deleted through any action.
- Server-calculated line and submission totals match the displayed totals.
- Awarded status cannot be set without an approved decision.
- Estimate import rejects unapproved decisions and locked estimates.
- Import preview and committed estimate totals reconcile exactly.
- Every imported estimate line links to immutable submission and decision
  evidence.
- Retried submit/approve/import requests are idempotent.
- Voids, replacements, and corrected submissions remain visible in activity
  history.
