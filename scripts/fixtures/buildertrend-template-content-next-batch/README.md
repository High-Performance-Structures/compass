# Buildertrend next-batch content capture

This directory receives reviewed, read-only Buildertrend capture fragments for
the 34 active templates that were not part of the completed six-template pilot.
Do not create placeholder content and do not mutate the Buildertrend sources.

The deterministic manifest is
`scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json`. Its current
reviewed release covers workplan sequences 6–13, 15–16, 18, 20–24, 26–28,
and 30–32,
excluding sequence 10 because Drywall was already completed in the pilot and
sequences 14, 17, 19, 25, 29, and 33–40 because their captures remain
incomplete:

1. Ext. Finishes - Stucco (`12859981`)
2. MEP - Rough & Top Out (`12978371`)
3. Concrete - Footer Assembly (`12581937`)
4. Concrete - Slab Assembly (`12594475`)
5. Ext. Finishes - Siding (`30917204`)
6. Framing - Interior Wall Assembly (`12646335`)
7. Framing - Roof w/ Trusses Assembly (`12650792`)
8. Framing - Fascia & Soffit Installation (`12819873`)
9. Framing - Floor System Assembly (`12649495`)
10. Int. Finishes - Tiling (`30914491`)
11. Concrete - Piers Assembly (`12858966`)
12. Framing - Exterior Wall Assembly (`12649292`)
13. Earthwork - Post-Frost Wall Earthwork (`12650557`)
14. Framing - Overhead Door Installation (`30919251`)
15. Framing - Exterior Man Door Installation (`12650484`)
16. Framing - Stair Installation (`12650713`)
17. Int. Finishes - Interior Doors (`28466146`)
18. Int. Finishes - Stain & Seal Concrete Floors (`12979213`)
19. Framing - Rough inspection w/ Draft & Firestop (`12978590`)
20. Int. Finishes - Painting/Staining (`36619183`)
21. Int. Finishes - Flooring (`38452172`)

Place capture files under `fragments/` using the exact `fragmentPath` from the
manifest. A fragment must identify one template and may contain one or more of
`tasks`, `selections`, and `bidPackages`. Every supplied module must contain the
exact reviewed number of source rows, with unique `sourceItemId` values and
non-empty titles. Never put `schedule` or `scheduleItems` in these fragments;
those 93 rows and their dependencies are already preserved in the reviewed
40-template source capture.

Partially recovered source evidence belongs in `incomplete-reviews/`, not
`fragments/`. The assembler does not discover that sibling directory and the
release allowlist must not reference its files. See the directory README for
the evidence-preservation and promotion gates.

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

The release allowlist contains Stucco (`12859981`), MEP Rough & Top Out
(`12978371`), Concrete Footer (`12581937`), Concrete Slab (`12594475`),
Siding (`30917204`), Framing Interior Wall (`12646335`), Framing Roof w/
Trusses (`12650792`), Framing Fascia & Soffit Installation (`12819873`),
Framing Floor System Assembly (`12649495`), Interior Finishes Tiling
(`30914491`), Concrete Piers (`12858966`), and Framing Exterior Wall Assembly
(`12649292`), Earthwork Post-Frost Wall Earthwork (`12650557`), Framing
Overhead Door Installation (`30919251`), and Framing Exterior Man Door
Installation (`12650484`), Framing Stair Installation (`12650713`), Interior
Doors (`28466146`), Stain & Seal Concrete Floors (`12979213`), Rough Inspection
with Draft & Firestop (`12978590`), Interior Painting/Staining (`36619183`),
and Interior Finishes Flooring (`38452172`).
Their browser gates are complete, and the assembler combines those fragments
with the already-reviewed schedule rows and
dependencies.

The guarded audit covers all 34 non-pilot active templates, not just the
twenty-one release entries. At the current checkpoint it includes 21
structurally complete templates, excludes 13 incomplete active templates, and
excludes all 27
archived templates. There are zero additional structurally complete templates
after this reviewed release. If another complete fragment appears, `--check`
deliberately fails the release as stale until its identity, counts, and
draft-only scope are reviewed in the release manifest.

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
draft version checks and leaves any still-draft Compass templates in
`content_captured` / `draft` state for staff review and later publication from
the Template Library. Siding also retains two explicit module-level conversion
exceptions because Buildertrend cleared multiple Cost Type assignments on two
unidentified bid rows while copying the source. The draft may be imported for
staff review, but those rows and values must be recovered from the source or a
supported export before publication or production use; the copied values must
not be used to infer them. Tiling also retains explicit conversion exceptions
for choice descriptions and nine attachment filenames that Buildertrend did
not expose during the reviewed capture. Their verified choice identities,
ordering, status, price, and attachment counts are preserved, but the missing
fields must not be inferred.
Interior Painting/Staining likewise preserves one verified attachment filename
and explicit counts for two additional source attachments whose filenames and
bytes were not exposed; those missing values remain a fail-closed conversion
exception and must not be inferred.
Flooring retains one explicit conversion exception
for the filenames of seven verified choice attachments; the choice identities,
descriptions, ordering, status, price, and attachment counts are preserved.

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
  --source-template-id <buildertrend-template-id> \
  --verification-part <1-6> \
  --output <preflight.sql>

bunx wrangler d1 execute <database-name> --remote --file <preflight.sql> --json
```

Run all six verification parts for each release template. The scoped parts
remain under Cloudflare D1's compound-query limit. Proceed only when every
query returns zero issue rows. Preflight requires one
matching draft template and version per source ID, exact source module counts,
no applications, and either zero content rows or a complete prior replay. A
partial prior import is rejected.

After applying the reviewed import, generate and execute the same query with
`--phase postflight`. Postflight requires exactly 541 content rows (421 tasks,
78 schedule items, 30 selections, and 12 bid packages), 78 reusable
schedule rows, 59 schedule predecessor edges in both representations, exact
deterministic source identities, valid JSON without Buildertrend URLs, draft
versions, and `content_captured` / `draft` template state. Zero rows means the
verification passed.

For a production idempotency check, run the reviewed import a second time only
after the first postflight returns zero rows, then rerun the same postflight.
It must again return zero rows. The automated regression test performs this
two-pass comparison against a temporary SQLite database and verifies that the
complete content snapshot is byte-for-byte unchanged.
