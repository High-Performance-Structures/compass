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

## Next Capture Pass

For each of the 40 inventory records:

1. Capture the stable Buildertrend template ID and direct source URL.
2. Capture schedule item IDs, titles, phases, durations, relative starts,
   colors, milestones, visibility, assignee placeholders, and notes.
3. Capture predecessor relationships, relationship types, and lag values.
4. Record counts for Tasks, Bid Packages, Estimates, Purchase Orders, Bills,
   document folders, photo folders, Selections, and Specifications without
   promoting them into operational or Sage-facing tables.
5. Validate the dependency graph and item count against Buildertrend.
6. Publish version 1 and mark the template verified only after review.

Schedule definitions are the first promotion target. Task/checklist templates
follow next, then folders, specifications, and finish selections. Financial
features remain definitions until their Sage mappings and approval behavior are
explicitly reviewed.
