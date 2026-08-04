# Buildertrend Template Library Foundation

## Scope

The authenticated Buildertrend template inventory contained 67 templates on
July 31, 2026. Twenty-seven were explicitly archived, leaving 40 active-source
templates in scope for Compass.

Archived templates are not imported. The active inventory parser rejects a
template when its name begins with `ARCHIVE` or its source metadata marks it as
archived, inactive, or deleted. The import summary may retain the number of
excluded records, but it emits no usable record for them.

## Compass Model

Templates are reusable definitions, not projects and not active schedule
records. The foundation stores:

- organization-scoped template metadata and source provenance;
- immutable numbered versions;
- per-version module inventories;
- relative schedule items and dependencies;
- normalized task, selection, and bid-package content with the complete source
  payload retained locally per item;
- each project application and the generated schedule-item mappings.

A Buildertrend inventory row begins as `inventory_only`. It cannot be applied
to a project until its content has been captured, reviewed, published as a
version, and the template is marked `verified` and `active`.

Applying a version creates independent project schedule items. Later edits to
the source template do not alter an existing project. Every generated item is
linked to its application and template item for audit and duplicate review.

## Initial User Flow

- Internal staff can review the inventory at `/dashboard/templates`.
- A project schedule's overflow menu includes `Add from template`.
- Only verified, active templates with a published version appear in the apply
  dialog.
- The user chooses a project start date. Relative workday offsets are applied
  using that project's workday exceptions.
- Template assignees remain placeholders until the project contact mapping
  workflow is completed.

## Estimate Template Flow

- Internal staff with budget-edit permission can create an estimate template
  from **Office maintenance → Template Library**.
- Estimate templates hold reusable CA22 document language, CSI divisions,
  active Sage cost codes, scope descriptions, default quantities and costs,
  markup, tax treatment, and owner visibility.
- A template remains a draft until staff explicitly publish it. Published
  versions are immutable; later editing starts a numbered draft revision.
- The project Estimate page offers **Start from template** or **Start blank**.
  Applying a template creates an independent project estimate draft and records
  the exact template version used.
- Taxable template lines may use a fixed active Sage tax code or inherit the
  project tax entity selected when the estimate is created. Compass recalculates
  markup and tax when it creates the project draft rather than copying stale
  totals from the template.
- Publishing or revising a master template never changes an existing project
  estimate, accepted contract budget, change order, or pay application.

## Import Commands

Validate the active inventory without producing SQL:

```bash
bun scripts/build-buildertrend-template-inventory-sql.mjs \
  --input scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json \
  --organization-id <organization-id> \
  --dry-run
```

Generate an idempotent inventory import:

```bash
bun scripts/build-buildertrend-template-inventory-sql.mjs \
  --input scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json \
  --organization-id <organization-id> \
  --output <reviewed-output.sql>
```

The expected dry-run result is 40 imported active-source rows and 27 excluded
archived rows.

Capture stable Buildertrend IDs, module counts, and reviewed schedule content:

```bash
bun scripts/build-buildertrend-template-capture-sql.mjs \
  --inventory scripts/fixtures/buildertrend-active-template-inventory-2026-07-31.json \
  --capture scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json \
  --organization-id <organization-id> \
  --dry-run
```

The capture import is idempotent and draft-only unless
`--publish-captured-schedules` is supplied. That guarded option publishes only
schedule versions whose imported item and dependency counts exactly match the
captured Buildertrend data, then marks those templates verified and active.
Replaying the import can refresh draft content but cannot overwrite published
version content or downgrade a verified template. Buildertrend rows with
archive-prefixed names or archived/inactive/deleted source metadata are rejected
before SQL is generated. Generated files intentionally omit explicit
transaction statements because D1 file execution supplies its own transaction
boundary.

After migration `0089_template_content_classification.sql` is applied, a
count-verified content capture can be converted with:

```bash
bun scripts/build-buildertrend-template-content-sql.mjs \
  --inventory scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json \
  --capture <buildertrend-template-content.json> \
  --output <reviewed-content-import.sql>
```

The content importer requires exact coverage of all 40 reviewed active
template IDs, rejects archived or unexpected templates, and rejects any task,
selection, or bid-package module whose captured item count differs from the
reviewed Buildertrend inventory. Buildertrend URLs are removed recursively from
both display content and stored payloads. Template source links are no longer
exposed in Compass.

Internal staff can classify templates by department (ORC, HPS, Nu-Tech, or
Design) and category. Templates that have never been applied may be deleted;
applied templates remain available to the audit trail and must be made inactive
instead.

## Capture Progress

The authenticated My Templates grid provided stable Buildertrend IDs, direct
source links, schedule durations, and module counts for all 40 active records.
The 27 archive-prefixed records remain excluded.

All 30 active schedule-bearing templates were captured on August 3, 2026. The
capture contains 163 source schedule items with their Buildertrend IDs, titles,
phases, durations, relative starts, display colors, and predecessor edges,
including relationship type and signed lag. Buildertrend source colors are
retained in the capture and mapped to the nearest Compass schedule color when
the SQL is generated.

Fields that were not exposed consistently in Buildertrend remain deliberately
conservative: milestone state, assignee, owner visibility, subcontractor
visibility, and notes. They are recorded as pending field review in module
provenance instead of being guessed. Schedule content itself can be published
after the automated item, dependency, archive-exclusion, and cycle checks pass.

## Remaining Capture Gate

Schedule definitions are complete. Task/checklist, selection-choice, and bid
package content must pass exact module-count reconciliation before the content
import is generated or applied. Financial features remain definitions until
their Sage mappings and approval behavior are explicitly reviewed.

Buildertrend does not expose a single spreadsheet export for a project
template. In the authenticated template workspace, Bid Packages offers a
template-scoped Excel export, Selections offers a print report, Schedule offers
import/copy actions only, and the documented Tasks Excel action is not exposed
in the template-scoped task list. A partial export must not be treated as a
complete template capture. The remaining modules therefore require either a
Buildertrend Data Entry/Support export or a count-reconciled authenticated
capture before the verified Compass import can run.
