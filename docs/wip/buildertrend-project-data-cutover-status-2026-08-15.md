# Buildertrend Project-Data Cutover Status

Updated: 2026-08-17

This public ledger records the technical state and safety requirements of the
Buildertrend-to-Compass project-data cutover. Client names, project identifiers,
file names, Drive references, contact details, and project-specific financial
details are intentionally excluded.

## Completed and verified

- Current schedules were refreshed for active projects with verified source
  captures while preserving Compass-authored rows, audience settings,
  dependencies, and review state.
- Operational project identity and project-operation links were detached from
  Buildertrend while retaining internal external IDs for deterministic
  reconciliation.
- Most imported RFI attachments were matched to exact Google Drive files and
  relinked.
- Already-uploaded owner-update photos were matched one-to-one by source file ID
  and relinked without duplicate uploads.
- All externally hosted daily-log photos for the two priority active projects were
  recovered, uploaded to their verified project Pictures folders, and relinked.
- All missing local-preview photo rows were resolved using either an unambiguous
  same-project Drive match or a recovered authenticated source original. Duplicate
  legacy rows reuse one verified file rather than creating duplicate uploads.
- The legacy office-project batch was resolved by recovering genuine images and
  removing document thumbnails that had been misclassified as photographs after
  confirming the underlying documents remained in Drive.
- Imported message attachments use non-Buildertrend storage.
- User-facing imported messages, daily logs, finish selections, and change
  orders no longer expose Buildertrend provenance URLs. Internal source IDs are
  retained for deterministic reconciliation.
- Historical pay-application package links for the two priority active projects
  now open the verified complete packages in Google Drive.
- The identified Sage test vendor bill is quarantined from operational queues.
- Promoted project records have operational IDs, and no orphaned promotion
  pointers were found.
- Buildertrend provenance remains in internal archive tables as migration
  evidence. It is not an operational dependency and must be retained.

## Remaining file recovery

- No operational daily-log photos remain on Buildertrend URLs or missing local
  preview assets.
- One project RFI attachment remains source-only because no exact Drive match was
  found. A file with a different revision date must not be substituted.
- A small set of historical panorama records remains intentionally pointer-only.
- The staged-file inventory is otherwise verified. Unresolved records remain
  explicit rather than being silently blanked.

## Operational-link cleanup

The guarded cleanup has been applied to production. It removed only removable
Buildertrend provenance from:

- final-line links in imported project messages;
- first-line source URLs in imported daily logs;
- trailing source URLs in historical finish-selection notes; and
- source-link fields on imported change orders.

The operation ran through D1's atomic file-execution path with a pre-change Time
Travel bookmark. Substantive content, source IDs, authors, recipients, statuses,
and timestamps were preserved.

## Review-gated project-data gaps

- Open imported to-dos remain staged where dates, assignees, hierarchy, or parent
  relationships are incomplete. Blind promotion would create misleading
  duplicate work.
- Historical Buildertrend warranty claims still require review-gated capture and
  promotion into the new Compass warranty workflow.
- Executed imported change orders need supporting acceptance documents before
  their remaining source references can be removed.
- Some owner assignments on active or warranty projects are not yet represented
  in project contacts. Access remains ungranted until identity and contact details
  are verified.
- Several active projects have partial or absent module captures. Each requires a
  verified import or an explicit not-applicable or empty-source attestation before
  the cutover can be declared complete.

## Financial and Sage reconciliation gates

- Imported G703 detail contains duplicate business-key rows and header/detail
  differences that must be reconciled against source packages and Sage.
- Sage and Google pay-application baselines differ. The records are a
  reconciliation pair, not disposable duplicates.
- Complete Drive pay-request packages for the priority projects are linked from
  their historical Compass applications. Remaining projects still require the
  same exact-file reconciliation.
- Imported change orders still need cost-code, phase, budget-ledger, and Sage
  mappings before they can drive G703 values.
- Broader financial cutover requires verified active-project Sage mappings, a
  refreshed cost-code catalog, and populated tax entities.
- Test submissions must be quarantined before broad Sage synchronization.

## Intentional archive-only records

Do not bulk-promote:

- schedules explicitly classified as historical, offline, or stale;
- completed or stale historical tasks;
- claim and dispute archives retained for evidence;
- verified empty-source markers; and
- pointer-only historical panorama records.

## Warranty workflow

Compass now has a first-class, project-scoped warranty workflow with:

- owner submissions available only during Warranty or Service project stages;
- internal status, priority, assignment, visit, resolution, and deletion controls;
- owner resolution confirmation;
- project-Drive evidence uploads delivered through protected Compass downloads;
- owner-safe history separated from internal notes;
- activity and opt-in notification events; and
- a dedicated review-gated staging table for historical Buildertrend claims.

The warranty database migration must be applied before the corresponding
application release. Historical source records will remain review-gated rather
than being bulk-promoted.

## Completion criteria

The project-data cutover can be called complete only when:

1. Operational views contain no Buildertrend links or missing local assets.
2. Recoverable files are copied to verified project Drive folders without
   duplicate uploads.
3. Unrecoverable records remain explicit and reviewable rather than silently
   blanked.
4. Open to-dos and contacts are promoted only after hierarchy and identity review.
5. Warranty claims have a first-class Compass workflow.
6. Pay applications, change orders, G703 detail, and Sage balances reconcile with
   preserved source evidence.
7. Projects with partial or absent module data have either a verified import or an
   explicit not-applicable or empty-source record.
