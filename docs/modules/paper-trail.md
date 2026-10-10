# Project paper trail

Compass keeps a readable PDF copy of each project record in the project's
Google Drive folder, so the paperwork survives even if the Compass database is
unavailable. The live record in Compass stays authoritative.

## What is saved, and where

| Record | Project subfolder |
|---|---|
| Purchase orders | Purchasing (`12_Purchasing`) |
| Estimates (full internal detail) | Estimate (`02_WorkingEstimate`) |
| RFIs | Communications (`06_Communications`) |
| Change orders | Change Orders (`11_ChangeOrders`) |

Each record has one **living copy** that is replaced in place when the record
changes; Google Drive keeps the earlier versions in its version history.
Milestones also save a **frozen copy** that is never changed:

| Milestone | Trigger |
|---|---|
| PO sent | Emailing the PO to the vendor |
| Estimate signed | `signed_at` or `accepted_at` is set |
| RFI answered | `answered_at` is set |
| Change order approved | `executed_at` is set |

A subfolder that does not exist yet is created with its standard name.

## Keeping Compass fast

- **Edits** do one small upsert (`markPaperTrailDue`) and never wait on Drive.
  A failure there is logged and the edit still succeeds.
- **The scheduled job** (`/api/operations/paper-trail/run`, every minute) only
  writes records whose last edit is older than the company's quiet period
  (default 3 minutes), at most four records and two milestone copies per run.
  Records whose content version has not changed are skipped without rendering.
- **The change sweep** (every ten minutes) queues records changed outside the
  hooked actions, such as estimate line edits or Sage syncs, and reads
  milestones from stored dates. The first sweep after the feature is turned on
  queues every existing record, which is the catch-up.
- **Sharing checks** are cached for an hour per folder.

PDFs are rendered with Cloudflare Browser Run from a self-contained record
sheet (`src/lib/paper-trail/document.ts`): inline styles, no scripts, no app
page or session involved.

## Sharing safeguards

Internal records (costs, markup, budgets) must never land where clients or
vendors can see them. Before writing, the job checks the project folder and
the target subfolder:

- If the subfolder is shared with anyone outside the company's email domains,
  the copy goes to a private `Compass Records (internal)` folder instead and
  the record shows that it was held there.
- If the project folder itself is shared outside, nothing is written, because
  every folder inside would inherit that sharing; the record shows why.

The connected Google account's domain always counts as inside. Other company
domains are listed in the paper trail settings.

RFQ emails may share whole folders only from Plans and Submittals; individual
files can still come from anywhere in the project.

## Settings

Settings → Workflows → Project paper trail (admins). The feature ships **off**.

- **Saving**: Off, Test projects only, or All projects.
- **Records to save**: one switch per record type, plus milestone copies.
- **Wait after the last edit**: the quiet period, 1–60 minutes.
- **Company email domains**: domains that count as inside the company.

Each saved record shows a status line ("Saved to Drive 2:14 PM", a link to the
copy, and **Save to Drive now**) on the purchase order, RFI, change order, and
estimate pages while the feature is on for that project.

## Tables

- `project_record_drive_files`: one row per record: status, quiet-period clock
  (`changed_at`), last seen record change (`source_changed_at`), Drive file,
  content version, and retry state.
- `project_record_drive_snapshots`: frozen milestone copies.
- `drive_folder_share_checks`: cached "shared outside the company" answers.
