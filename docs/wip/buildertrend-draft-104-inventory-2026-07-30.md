# Buildertrend Draft PR 104 Inventory

## Purpose

This inventory accounts for the Buildertrend cutover work embedded in draft
PR #104 without merging its 138-commit divergent history. It uses commit
headlines, changed file paths, and generic source code only. It does not copy
captured customer records, secrets, local paths, or preservation evidence into
the repository.

Inventory snapshot:

- draft ref: `jarvis/photo-selection-owner-updates`
- draft head: `a1117d59b7ad31c4e742ce169a85239b0506c438`
- reviewed main: `1ec11a087f27e78bf9db229d9d009bbfb6465fa2`
- retained cutover commits: 3
- excluded product/UI commits: 135

The 135 excluded commits are not cutover source material. They cover owner
updates, conversations, permissions, notifications, scheduling, mobile,
financial intake, and other product work that has since been delivered,
superseded, or independently tracked on current `main`. They must not be
cherry-picked as part of the Buildertrend/Sage recovery.

## Retained commit inventory

### `de1c5a8` — Buildertrend client access

| Draft file | Disposition |
| --- | --- |
| `drizzle/0061_customer_directory_source_fields.sql` | Do not replay the stale migration. Rebuild contact/access review from the current migration tip under #156. |
| `scripts/build-buildertrend-client-access-sql.mjs` | Retain as design evidence for #156. Staged contacts must never grant access. |
| `scripts/import-buildertrend-client-access-local.mjs` | Do not promote directly. Replace with review-only, organization-scoped tooling under #156. |
| `src/app/actions/customers.ts` | Do not cherry-pick. Current customer actions remain authoritative. |
| `src/db/schema.ts` | Do not cherry-pick. Recreate only required source-link fields in the current modular schema under #156. |

This commit is fully accounted for by #156. Its automatic-access assumptions
are intentionally not retained.

### `547c98d` — Buildertrend archive staging

| Draft file | Disposition |
| --- | --- |
| `docs/wip/buildertrend-migration-plan-2026-07-06.md` | Superseded by the current recovery baseline and this inventory under #147. |
| `docs/wip/compass-google-sage-integration-plan.md` | Existing current-main plan remains the reference; do not replay the old patch. |
| `drizzle/0062_buildertrend_migration_staging.sql` | Superseded by migrations 0084 and 0085 delivered through #149 and #152. |
| `scripts/build-buildertrend-job-inventory-staging-sql.mjs` | Superseded for inventory normalization by #281; final active-project deltas remain tracked in #150. |
| `scripts/build-buildertrend-lead-opportunity-staging-sql.mjs` | Superseded for lead identity inventory by #281 and #292; operational lead history remains tracked in #154 and #158. |
| `scripts/build-buildertrend-lead-proposal-staging-sql.mjs` | Retained as design evidence for archive-first operational and financial history under #154 and #155. |
| `src/db/schema.ts` | Superseded by the modular Buildertrend staging schema delivered through #149 and #152. |

The staging foundation, deterministic inventory normalization, and explicit
identity review portions are delivered on current `main`. Remaining record
types stay in their dedicated issues.

### `0b22692` — All-status archive inventory

| Draft file | Disposition |
| --- | --- |
| `docs/wip/buildertrend-migration-plan-2026-07-06.md` | Superseded by the current recovery baseline and issue-specific acceptance criteria. |
| `scripts/build-buildertrend-client-contact-staging-sql.mjs` | Retain as design evidence for deduplicated contact and access review under #156. |
| `scripts/build-buildertrend-job-inventory-staging-sql.mjs` | Superseded by the all-status and visible job inventory generators delivered through #281; final cutoff capture remains #150. |
| `scripts/build-buildertrend-report-snapshot-staging-sql.mjs` | Retain as design evidence for archive-first record imports and historical search under #154 and #158. Restricted evidence remains #148. |

## Clean-main delivery map

| Slice | Tracking | Status |
| --- | --- | --- |
| Reproducible staging and immutable observations | #149, PRs #272 and #281 | Delivered |
| Job/lead/customer identity reconciliation | #152, PR #292 | Delivered |
| Final active-project delta and source cutoff | #150 | Open |
| Restricted evidence archive | #148 | Open |
| Archive-first operational records and report snapshots | #154 | Open |
| Read-only proposal and financial history | #155 | Open |
| Contact deduplication and scoped invitations | #156 | Open |
| Historical/archive search | #158 | Open |

## Retirement decision

Every retained Buildertrend cutover file in draft PR #104 now has either:

1. a delivered clean-main replacement; or
2. an explicit issue that owns its safe reimplementation.

Draft PR #104 can therefore be closed as superseded. Its branch remains
historical source material and must not be merged or used as a deployment
branch. No customer data is included in this inventory.
