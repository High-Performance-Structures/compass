# Buildertrend Cutover Recovery Baseline

## Purpose

This baseline defines how to recover the Buildertrend and Sage cutover work
without merging a long-lived, divergent development branch into current
`main`. It complements the cutover epic in GitHub issue #144 and the extraction
work tracked in #147.

The primary rule is simple: treat the divergent branch and local working files
as an inventory source, then forward-port reviewed capabilities through small
branches based on current `main`.

## Current baseline

- Current production migrations end at `0080_work_calendar_recurrence.sql`.
- The historical staging migration number must not be reused.
- The first recovered migration is
  `0084_buildertrend_staging_foundation.sql`.
- Existing production activity, scheduling, audience, owner-update, and
  financial-read models remain authoritative.
- Buildertrend imports are archive and review operations by default.
- Sage remains server-side and read-only by default.

## Recovery classification

### Foundation

Recover first:

- organization-scoped import runs;
- replay-safe source records;
- immutable run-to-record observation history;
- Drive-backed archive-file pointers;
- review-only access candidates;
- explicit source keys and deterministic replay behavior;
- explicit unresolved-reference and changed-reference quarantine states;
- dry-run and manifest validation.

The staging foundation does not create projects, grant access, notify users,
promote operational records, or write to Sage.

Replays may backfill a previously unresolved project or source reference, but
they do not move an already-resolved record. Changed references, identities, or
evidence pointers are quarantined for review and retained in immutable
run-observation payloads. Source capture fields, verified evidence, and human
review fields are stored separately so an incomplete replay cannot erase
preserved evidence or reviewer decisions. A manifest fingerprint prevents a
run key from being reused with different membership.

### Generic generators

Recover after the foundation:

- job inventory;
- lead and proposal inventory;
- generic report snapshots;
- shared manifest normalization;
- Drive archive and reconciliation helpers.

Every generator must require explicit organization context, validate project
ownership, produce a reconciliation summary, and support dry-run operation.

The job and lead-opportunity adapter is intentionally separate from proposal
and payment history. It converts captured inventory rows into the normalized
staging manifest, but it does not infer a project from a project number or
name. The normalized manifest then flows through the organization-scoped
staging SQL generator. Lead proposals remain a later financial-history slice
so Buildertrend amounts and payment labels cannot be mistaken for Sage
authority.

Example review-only pipeline:

```bash
bun scripts/build-buildertrend-inventory-manifest.mjs \
  --input path/to/captured-jobs.json \
  --kind jobs \
  --run-key buildertrend-jobs-YYYY-MM-DD \
  --source-label "Buildertrend job inventory" \
  --captured-at 2026-07-30T12:00:00.000Z \
  --expected-row-count EXPECTED_CAPTURE_COUNT \
  --output path/to/staging-manifest.json

bun scripts/build-buildertrend-staging-sql.mjs \
  --input path/to/staging-manifest.json \
  --organization-id organization-id \
  --output path/to/review-only-import.sql
```

Both commands support `--dry-run`. Generated SQL remains confined to
`buildertrend_staging_*` tables. Empty, failed, count-mismatched, duplicate,
and identity-inconsistent captures fail closed. The inventory adapter reports
only whether an explicit project ID was supplied; authoritative organization
ownership and project resolution occur in the organization-scoped staging
step.

### Operational history

Recover in independent, reviewable branches:

1. daily logs, owner updates, and approved photo history;
2. conversations and RFI history;
3. schedules, tasks, and dependencies;
4. purchase orders, selections, and financial archive history;
5. cutover readiness and exception reporting.

Historical imports must not overwrite newer Compass-authored work or trigger
the normal notification lifecycle.

### Identity reconciliation

Buildertrend job and lead IDs are the source identities. Project numbers,
customer names, email addresses, and accounting-customer records are review
evidence only and must never collapse distinct Buildertrend jobs.

Identity review manifests record immutable decisions and explicit
relationships for same-owner projects, development phases, continuations,
department transitions, and lead-to-project conversions. They may reference an
existing Compass project or customer within the same organization, but they do
not create projects, grant portal access, invite contacts, or modify the source
staging record. Pooled accounting customers are provenance only and can never
become portal identities through the identity-review workflow.

### Restricted preservation evidence

Client-, dispute-, claim-, and project-specific preservation material belongs
in the private evidence archive. Production code may retain reusable parsing or
reconciliation behavior only after it is generalized, tested, and stripped of
local paths, operator identities, source IDs, Drive IDs, and client data.

The guarded canonical warranty register is tracked separately in issue #271.

### Do not recover as written

- migrations with obsolete sequence numbers;
- complete schema snapshots from the divergent branch;
- project-number-only identity matching;
- hard-coded organization, project, user, or filesystem values;
- automatic portal access decisions;
- scripts that treat captured financial evidence as authorization for a Sage
  or Compass financial write.

## Issue map

- #144 — Buildertrend cutover and Sage integration epic
- #145 — fail-closed Sage queue
- #147 — extract and baseline divergent cutover work
- #148 — restricted preservation archive
- #149 — reproducible staging and importer framework
- #150–#158 — Buildertrend exit, archive, identity, and reconciliation
- #159–#164 — Sage read models, audit, approvals, and controlled automation
- #165 — cutover certification and rollback package
- #263 — guarded owner collaboration workspace
- #271 — historical warranty and claim import

## Release gates

Each recovered slice must demonstrate:

- clean branch ancestry from current `main`;
- additive migrations generated after the current migration tip;
- organization and project isolation;
- deterministic, idempotent replay;
- dry-run and validation output;
- no implicit access grant, notification, promotion, or Sage write;
- clean-database migration reproduction;
- tests and a reconciliation summary;
- a linked GitHub issue and production verification before closure.
