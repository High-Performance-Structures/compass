# Custom estimate report phases

Custom report phases are available in every department (H, O, N, and D). They
control customer-facing presentation, not job-cost accounting or calculations.

## Workflow

In **Client report presentation**, select **Add report phase**. Choose a source
CSI division, customer-facing name, scope description, and report order. Select
the estimate lines belonging to that phase. Multiple phases may share one source
division; there is no application-defined phase count, line count, or dollar cap.

Check **Itemize costs for the client** to show individual lines and their assembly
breakdown costs, followed by the phase subtotal. Leave it unchecked to show just
the name, scope description, and phase subtotal. Internal-only lines remain hidden.
An assembly's breakdowns stay with its parent estimate line.

Each estimate line belongs to at most one phase. Selecting a line currently in
another phase moves it into the selected phase. The line editor also provides a
phase selector filtered by its source CSI division.

CSI divisions retain their original order. Within each division, custom phases
print in report order, followed by unassigned lines in their original CSI group,
using the estimate's default report detail choice and legacy
CSI group descriptions. Empty phases do not print. Estimates without custom
phases retain their existing compact report layout.

Deleting a phase requires budget delete permission and confirmation. It preserves
all estimate lines, breakdowns, costs, and original CSI codes, returning the lines
to their default grouping. Phase deletion details are recorded in project history.

## Persistence and safety

- `project_estimate_report_phases` stores estimate-scoped presentation records.
- `project_estimate_lines.report_phase_id` references a phase, with `ON DELETE SET NULL`.
- Phase saves atomically update presentation, membership, and signature preparation
  invalidation. Membership writes are chunked below D1's statement parameter limit.
- Mutations require internal staff, project access, budget update/delete permission,
  and an editable draft/internal-review estimate. There is no department restriction.
- Revisions copy phase definitions to new IDs and remap assignments in the same
  transaction as estimate duplication.
- Signature source hashes include phase definitions, assignments, and itemized
  breakdown presentation, so a report change requires fresh signature preparation.
- Invalid/missing phase assignments fall back to original CSI grouping rather than
  omitting costs. Phase subtotals count parent lines once, not again for breakdowns.

Migration `0161_estimate_report_phases.sql` is additive. Apply it before deploying
the feature; existing lines start with a null phase assignment. Do not apply it to
production until the preview and release are approved.

## Local example

Run `bun scripts/preview-estimate-report-phases.tsx` to generate an illustrative
mixed-detail report under `output/pdf/`. This uses the same grouping and report
component as the customer report, with sample costs rather than live project data.
