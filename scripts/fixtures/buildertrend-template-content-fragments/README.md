# Buildertrend pilot content fragments

Place reviewed browser-capture JSON fragments here, one file per template or module. The assembler accepts:

- a raw template object;
- `{ "template": { ... }, "conversionExceptions": [] }`; or
- a capture envelope with `templates` and `conversionExceptions` arrays.

Fragments may split a template across modules. Repeating the same module is accepted only when its JSON is identical; conflicting duplicates stop assembly. Never add placeholder rows to satisfy a count.

The reviewed six-template module counts are:

| Source ID | Template | Tasks | Schedule | Selections | Bid packages |
| --- | --- | ---: | ---: | ---: | ---: |
| `30294726` | Drywall Installation | 28 | 8 | 3 | 1 |
| `12978716` | Ext. Finishes - Roofing | 14 | 2 | 103 | 1 |
| `32043577` | Design & Preconstruction | 48 | 34 | 0 | 0 |
| `12667545` | Concrete - LiteDeck Assembly | 50 | 15 | 0 | 0 |
| `12540389` | Concrete - ICF Assembly | 59 | 5 | 0 | 0 |
| `30907034` | Int. Finishes - Cabinetry/Countertops | 50 | 6 | 4 | 2 |

Schedule rows and dependencies come from the already reviewed 40-template capture. The assembler embeds the exact dependency edges in each successor's `predecessors` array.

During capture, use `--allow-incomplete` to obtain a missing-module report:

```bash
bun scripts/assemble-buildertrend-template-content-pilot.mjs \
  --manifest scripts/fixtures/buildertrend-template-pilot-2026-08-03.json \
  --reviewed-capture scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json \
  --base scripts/fixtures/buildertrend-template-content-pilot-2026-08-03.json \
  --fragments scripts/fixtures/buildertrend-template-content-fragments \
  --check --allow-incomplete
```

Before import, omit `--allow-incomplete`. That strict check requires all six identities and every exact module count, rejects duplicate source IDs, and rejects non-pilot or archived templates.

For the final reviewed artifact, write both the six-template content capture and
its exact six-template inventory. Those paired files can be passed directly to
the content SQL builder after the full 40-template inventory has already been
imported:

```bash
bun scripts/assemble-buildertrend-template-content-pilot.mjs \
  --manifest scripts/fixtures/buildertrend-template-pilot-2026-08-03.json \
  --reviewed-capture scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json \
  --base scripts/fixtures/buildertrend-template-content-pilot-2026-08-03.json \
  --fragments scripts/fixtures/buildertrend-template-content-fragments \
  --output <six-template-content.json> \
  --inventory-output <six-template-inventory.json>

bun scripts/build-buildertrend-template-content-sql.mjs \
  --inventory <six-template-inventory.json> \
  --capture <six-template-content.json> \
  --output <reviewed-content-import.sql>
```
