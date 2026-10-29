# Buildertrend printed daily-log imports

Use `scripts/build-buildertrend-daily-log-pdf-import.mjs` for preserved **Daily Log
Print** PDFs. This operator tool prepares reviewable SQL and recovery evidence;
it never connects to Drive, D1, Sage, email or notifications, and never executes
SQL. The former ad hoc `archive-job.ts` must not be reused or run with
`--replace`.

Preserve originals in the correct existing client Drive folder. Save working
plans and evidence in the established Developer folder. Local files used below
are temporary processing buffers; verify cloud copies before removing them.

## Inspect the original

Install the normal Poppler `pdftotext` utility if it is not already available.
First verify the current Drive original's exact bytes, SHA-256, size, client
folder and existing audience. Download that same original into a temporary
processing buffer and inspect it:

```sh
node scripts/build-buildertrend-daily-log-pdf-import.mjs \
  --pdf <temporary-original.pdf> --inspect > <temporary-inspection.json>
```

Inspection runs `pdftotext -layout`, reports both hashes and retains each parsed
source block. Verify representative pages against the rendered original,
including page breaks, blank notes, differing weather dates, authors, comments
and attachment references. An unsupported or ambiguous layout fails closed.
Blank printed titles remain unknown; missing printed dates or authors need
source review. The printed heading controls the log date. Weather, filename,
print and import dates never fill a missing log date.

## Prepare a plan

Build an input JSON with these fields:

| Field | Required evidence |
| --- | --- |
| `recordedAt` | Fixed ISO timestamp for this prepared operation; retain it on retries. |
| `project` | Current complete project row, including ID, name, project number and Drive folder. |
| `source.driveId`, `fileName`, `sha256`, `bytes` | Exact current client Drive original. |
| `source.parentIds`, `remoteBytesVerified` | Current metadata and exact cloud-byte verification. The source must be directly in the project's verified folder. |
| `source.layoutTextSha256` | Hash from the inspection above, generated from those same PDF bytes. |
| `source.printedJobLabel` | Exact printed job label, reviewed against the intended project. |
| `source.buildertrendJobId` | Verified numeric job identity; this is not inferred from a filename or name. |
| `baseline.buildertrendBinding` | Complete current `project_external_links` row mapping that project to that Buildertrend job. |
| `baseline.logs` | All complete current `daily_logs` rows for the project, including native operational rows. |
| `baseline.documents` | All complete current `project_documents` rows for the project. |

Read baselines immediately before preparing the plan. Do not invent flags,
missing rows, mappings or empty baseline arrays to make preparation pass.

```sh
node scripts/build-buildertrend-daily-log-pdf-import.mjs \
  --pdf <temporary-original.pdf> --input <temporary-input.json> --dry-run

node scripts/build-buildertrend-daily-log-pdf-import.mjs \
  --pdf <temporary-original.pdf> --input <temporary-input.json> \
  --output-prefix <temporary-operation-prefix>
```

The second command creates `.plan.json`, `.apply.sql` and `.inverse.sql` with
exclusive creation. Any failure means preparation is incomplete; inspect the
files before attempting a new prefix. The JSON contains the same SQL, source
blocks, exact before-images and proposed rows.

Printed Added By labels are stored in `tags.buildertrendAuthor`, never as crew
attendance or a guessed account. Rows remain internal drafts. The document
reuses the existing Drive original and has a protected-file availability
timestamp with no attributed business approver or external visibility.

IDs explicitly identify a PDF snapshot and entry position. They do **not** claim
to be numeric Buildertrend log IDs. An exact snapshot repeat can be a no-op.
Different exports, legacy imports and any other existing Buildertrend history
require an exact source-lineage reconciliation before importing: the tool
refuses replacement, date/body deduplication and automatic overlap deletion.
Keep those history rows and originals while that review is open. A 100-entry
export raises a possible cap; verify the actual source count before claiming
either truncation or complete history.

## Review, apply and verify

Freeze scope, rehearse apply and inverse against the real schema and before-
images, and obtain independent code/plan review. Back up and verify the exact
operation, source proofs and inverse in the private Developer folder before any
write. Apply the entire SQL file atomically using the approved D1 workflow.
Guards are split into statements of at most 90,000 UTF-8 bytes, below D1's
[100,000-byte per-statement limit](https://developers.cloudflare.com/d1/platform/limits/).
All guards precede all writes in the same file; an individually oversized source
row fails during preparation. Do not split guards from their writes. Changed baseline rows or source/project
bindings must abort the transaction. A failed/unknown execution must be followed
by exact field readback before any retry; never replay because output parsing
or observation failed.

After apply, compare every proposed field and all preserved rows. Verify the
native staff cards, original dates, author labels and actual original-file
access. No source-completeness, comment, attachment-byte, audience-delivery or
whole-cutover acceptance follows from SQL counts alone. Final source deltas and
appropriate operational promotion remain separate requirements.

The inverse deletes only the exact new rows and document reference. It rejects
subsequent edits and known photo, labor, contact, task-event, task-link, meeting
and owner-update dependencies, plus later estimate-basis, plan-set and document-version
references. Inspect current schema/dependencies again before recovery; a
future schema change may add dependencies. It never deletes Drive originals,
other imported history or financial records.
