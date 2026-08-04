# Buildertrend next-batch content capture

This directory receives reviewed, read-only Buildertrend capture fragments for
the 34 active templates that were not part of the completed six-template pilot.
Do not create placeholder content and do not mutate the Buildertrend sources.

The deterministic manifest is
`scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json`. Its first
wave is workplan sequences 6–12, excluding sequence 10 because Drywall was
already completed in the pilot:

1. Ext. Finishes - Stucco (`12859981`)
2. MEP - Rough & Top Out (`12978371`)
3. Concrete - Footer Assembly (`12581937`)
4. Concrete - Slab Assembly (`12594475`)
5. Ext. Finishes - Siding (`30917204`)
6. Framing - Interior Wall Assembly (`12646335`)

Place capture files under `fragments/` using the exact `fragmentPath` from the
manifest. A fragment must identify one template and may contain one or more of
`tasks`, `selections`, and `bidPackages`. Every supplied module must contain the
exact reviewed number of source rows, with unique `sourceItemId` values and
non-empty titles. Never put `schedule` or `scheduleItems` in these fragments;
those 93 rows and their dependencies are already preserved in the reviewed
40-template source capture.

Check progress without treating missing source content as valid:

```bash
bun scripts/validate-buildertrend-template-next-batch.mjs
```

Block the priority wave or the full 34-template release until all required
browser-capture modules are present:

```bash
bun scripts/validate-buildertrend-template-next-batch.mjs --require-priority-complete
bun scripts/validate-buildertrend-template-next-batch.mjs --require-all-complete
```

## First guarded content release

The release allowlist currently contains only Stucco (`12859981`) and MEP Rough
& Top Out (`12978371`). Their browser gates are complete, and the assembler
combines those fragments with the already-reviewed schedule rows and
dependencies. Concrete Footer (`12581937`) remains explicitly excluded until
its browser task capture is complete.

The guarded audit covers all 34 non-pilot active templates, not just the two
release entries. At the current checkpoint it includes 2 structurally complete
templates, excludes 32 incomplete active templates, and excludes all 27
archived templates. There are zero additional structurally complete templates
after Stucco/MEP. If another complete fragment appears, `--check` deliberately
fails the release as stale until its identity, counts, and draft-only scope are
reviewed in the release manifest. This is also how Concrete Footer becomes
eligible once all 43 task rows have been captured; it is not permanently
hard-coded out.

```bash
bun scripts/assemble-buildertrend-template-next-batch-content.mjs --check

bun scripts/assemble-buildertrend-template-next-batch-content.mjs \
  --capture-output <reviewed-capture.json> \
  --inventory-output <reviewed-inventory.json>

bun scripts/build-buildertrend-template-next-batch-content-sql.mjs \
  --capture <reviewed-capture.json> \
  --inventory <reviewed-inventory.json> \
  --release scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json \
  --output <reviewed-import.sql>
```

Both commands reject publish flags. The generated content SQL is guarded by
draft version checks and leaves the two Compass templates in
`content_captured` / `draft` state for staff review and later publication from
the Template Library.

## Read-only production verification

Generate the preflight query before applying an import. The generator does not
connect to D1 and emits exactly one read-only `WITH ... SELECT` statement:

```bash
bun scripts/build-buildertrend-template-content-verification-sql.mjs \
  --capture <reviewed-capture.json> \
  --inventory <reviewed-inventory.json> \
  --release scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json \
  --organization-id <organization-id> \
  --phase preflight \
  --output <preflight.sql>

bunx wrangler d1 execute <database-name> --remote --file <preflight.sql> --json
```

Proceed only when the query returns zero issue rows. Preflight requires one
matching draft template and version per source ID, exact source module counts,
no applications, no Concrete Footer content, and either zero content rows or a
complete prior replay. A partial prior import is rejected.

After applying the reviewed import, generate and execute the same query with
`--phase postflight`. Postflight requires exactly 114 content rows (93 tasks,
14 schedule items, four selections, and three bid packages), ten schedule
predecessor edges, exact deterministic source identities, valid JSON without
Buildertrend URLs, draft versions, and `content_captured` / `draft` template
state. Zero rows means the verification passed.

For a production idempotency check, run the reviewed import a second time only
after the first postflight returns zero rows, then rerun the same postflight.
It must again return zero rows. The automated regression test performs this
two-pass comparison against a temporary SQLite database and verifies that the
complete content snapshot is byte-for-byte unchanged.
