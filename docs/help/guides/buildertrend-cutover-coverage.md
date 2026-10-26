---
{
  "id": "buildertrend.cutover",
  "featureId": "help-resources",
  "slug": "buildertrend-cutover-coverage",
  "title": "Buildertrend Cutover Coverage",
  "summary": "Interpret the read-only Buildertrend migration coverage dashboard and know when evidence is complete, stale, conflicting, or missing.",
  "contextSummary": "Cutover coverage is evidence, not a migration action. Verify each required module and resolve partial, stale, conflicting, blocked, or missing checks before treating a project as complete.",
  "category": "Administration",
  "tags": ["Buildertrend", "cutover", "migration", "coverage", "attestation", "stale", "conflict", "partial", "developer mode"],
  "audiences": ["staff"],
  "permissions": ["help:read"],
  "routes": ["/dashboard/office-maintenance/buildertrend-cutover"],
  "owner": "Compass migration operations",
  "lastReviewed": "2026-10-26"
}
---

## Open the Coverage Dashboard {#open-dashboard}

**Buildertrend cutover coverage** is restricted to authorized project-registry managers while developer mode is enabled. The page is read-only: opening it does not import or promote records, change a project, or grant owner or vendor portal access.

## Read the Summary {#interpret-coverage}

The summary shows mapped projects, required modules, verified checks, and the percentage of evidence complete. A module is complete only when its captured count has a matching completeness attestation, or a signed capture confirms Buildertrend contained zero records. Captured records without that final check remain **Partial**.

Use the module table to find where follow-through is needed:

- **Captured** and **Empty** are verified outcomes.
- **Partial** means records exist but the completeness attestation is missing or does not yet finish the check.
- **Stale** means live or unclassified project evidence is older than seven days and needs a fresh Buildertrend check.
- **Blocked / unavailable** records why the required source could not be verified.
- **Conflict** means the attested count no longer matches the staged evidence.
- **Missing** means no usable evidence has been recorded for that required check.
- **Complete** is the percentage of verified checks for that module, not a count of migrated records.

## Follow Through Safely {#resolve-gaps}

Start with conflicts and missing evidence, then stale, blocked, and partial checks. Confirm the exact project and module before collecting or attesting evidence. Do not infer completion from a zero count unless the signed capture explicitly verifies that Buildertrend contained no records. Refresh the dashboard after the underlying evidence workflow finishes and confirm the generated time and status changed as expected.

This dashboard reports coverage only. Use the approved migration and review workflow for the underlying records; do not treat a green percentage as permission to delete source data or grant portal access.

## Quick Check {#quick-check}

- [ ] I am reviewing the correct mapped projects and required modules.
- [ ] Every captured count has matching attestation evidence.
- [ ] Zero-record modules have a signed empty capture.
- [ ] Stale, blocked, conflicting, partial, and missing checks are resolved or explained.
- [ ] I did not treat the read-only dashboard as a migration action.

See [Navigating projects](/dashboard/help/navigating-projects) for project status and archive guidance.
