# Buildertrend schedule provenance cutover

This is an additive, isolated schema slice. It does not change live schedules,
grant access, import a backlog, or alter Sage or Google Drive records.

## Production baseline (SELECT-only, September 22, 2026)

- 2,715 promoted Buildertrend schedule source rows: 1,253 schedule items and
  1,462 schedule tasks. All 2,715 have a target; zero target-project mismatches,
  zero null project IDs, zero repeated source identity mapped to different tasks,
  and zero tasks mapped from multiple schedule source rows in the checked set.
- 661 project external links, including 258 Buildertrend links. Seven lead
  external IDs currently point to two projects. Fifty-one Buildertrend lead IDs
  occur under multiple staging project IDs. Neither table supports a global
  one-to-one source-ID constraint.
- Two approved identity decisions and one lead-conversion relationship exist.
  These review-run records are evidence, not a generic canonical identity table.
- All production inspection queries were SELECT-only and reported zero writes.

## Contract

The link stores the exact staging source row, Compass task FK, project and
organization scope, plus a snapshot of the task ID. Uniqueness applies to the
source-record/task-snapshot pair only; there is no global one-to-one constraint.
The task FK becomes null on authorized task deletion, while the snapshot and a
deletion timestamp preserve provenance. Source deletion is restricted. Triggers
reject insertion or reassignment across organizations/projects, incompatible
promotion state, and mutation of link history. Deleting a Compass task also
changes the linked staging source from promoted to archive_only. Its former
target ID remains as a historical pointer, not a live task claim. The tombstone
continues to prohibit source scope changes or re-promotion; a later refresh
must fail closed rather than recreate a staff-deleted operational task.

The refresh SQL creates each link after its staging record and task are
verified. It checks exact links before reporting success. Its existing
behavior updates task dates and progress, so it must be used only for the
specific schedule-refresh workflow and not as a generic provenance backfill.
The new link logic does not alter task IDs, assignees, or visibility.

## Staged deployment and backfill

1. Integrate the migration after the current main tip, renumbering if another
   branch has claimed 0164. Apply the table and triggers before using the
   updated schedule-refresh generator. Do not run an old bundle against the
   new schema or a new bundle before the migration.
2. Re-run SELECT-only gates for source/task/project scope, duplicate exact
   source–task pairs, conflicting existing links, and schedule rows changed
   since the September 22 baseline. Any nonzero conflict is a hold for
   adjudication, not a reason to overwrite operational schedules.
3. Backfill in bounded batches from promoted staging rows with verified
   organization and project scope, exact existing target IDs, and no conflicting
   link. Use deterministic link IDs and idempotent insert behavior. Never infer
   a target from title/date alone.
4. Postflight: compare the eligible exact source–task pair set in both
   directions with the link table, require zero scope mismatch, and verify that
   task dates, progress, assignees and visibility are unchanged. Repeat the
   batch to prove replay has zero changes.
   Test a deleted-task case: archived source, tombstoned link, no replacement
   operational task, and a fail-closed old refresh bundle.
5. Only then mark the provenance slice complete. This does not certify all
   schedules or other Buildertrend modules as migrated.

The existing cutover-readiness action in the shared checkout is untracked and
not on the integration base. Its raw SQL references the old
buildertrend_source_records and buildertrend_access_candidates table names;
the typed schema points to buildertrend_staging_records and
buildertrend_staging_access_candidates. A narrow diagnostic correction is
available in the isolated worktree but should be integrated only after the
owner of that action establishes its branch/base.
