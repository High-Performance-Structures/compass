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
