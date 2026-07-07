# Buildertrend Migration Plan

## Goal

Compass needs to capture the full Buildertrend record before HPS depends on it
less day to day. The migration should preserve active work, recent work,
preconstruction work, warranty work, completed work, archived projects, leads,
lead estimates, payments, messages, and files even when Compass does not yet
have a polished operational screen for every record type.

The migration has two different purposes:

1. Preserve Buildertrend history so HPS can search and rely on the record later.
2. Promote selected records into Compass workflows so staff, owners, subs, and
   vendors can work in Compass now.

Those two purposes should not be mixed. Historical capture can be broad and
read-only. Operational import should be reviewed, permissioned, and staged.

The practical target is:

- Compliance access: old records remain findable, exportable, and traceable.
- Current operations: active/recent projects and lead opportunities get enough
  normalized data to replace Buildertrend workflows.
- Product build-out: imported data reveals what Compass needs to show later,
  without forcing every legacy record into today's UI.

## Scope

Capture these Buildertrend areas wherever Buildertrend export, browser access,
or existing Google Drive archives allow it:

- jobs by status: active, preconstruction, warranty, completed, inactive, and
  archived
- leads and lead statuses
- lead estimates, proposals, allowances, and estimate attachments
- project estimates and proposal history
- customer and client contacts
- subcontractor, supplier, consultant, and vendor contacts
- project access assignments for owners, subs, suppliers, vendors, and staff
- schedules, milestones, dependencies, and completed schedule items
- tasks and to-dos
- RFIs
- POs
- RFQs/RFPs if available
- daily logs
- owner updates and Buildertrend AI owner update drafts/published updates
- project photos and photo albums
- messages and comments
- files, plans, specifications, selections, and other attached documents
- client invoices, accounts receivable records, payments, and payment history
- vendor bills or cost records available through Buildertrend

## Storage Model

Google Drive remains the document/photo source of truth for migrated artifacts.
Compass D1 should store metadata and pointers, not duplicate large files.

For files and photos:

- Store the original export/archive in Google Drive.
- Store Compass metadata: source system, Buildertrend ID, project ID, lead ID,
  file name, MIME type, date, visibility, review status, Google Drive file ID,
  Google Drive folder ID, checksum if available, and migration run ID.
- Use generated thumbnails only as disposable cache with provenance back to the
  original Google Drive file.

For structured records:

- Keep the raw Buildertrend payload or export row in an import/staging record.
- Normalize only the fields Compass needs for search, display, and workflow.
- Preserve the Buildertrend URL or ID as provenance.
- Mark records as `imported`, `needs_review`, `promoted`, `archived`,
  `duplicate`, or `ignored`.

## Migration Lanes

### Lane 1: Complete Archive Capture

This lane is for completeness. It should include active, preconstruction,
warranty, completed, inactive, archived, and lead records.

Archive capture creates:

- Google Drive archive folders for each Buildertrend job or lead.
- Raw export files, downloaded PDFs, ZIPs, photos, files, and message exports.
- Compass source manifests that point to the archived artifacts.
- Read-only Compass archive/search views where practical.

Archived or completed records should not automatically become editable Compass
workflow records. They should remain available for compliance, warranty
questions, owner/vendor disputes, historical estimating reference, and internal
research.

### Lane 2: Operational Import

This lane is for records staff need to use immediately in Compass.

Operational import initially targets:

- active projects
- recent projects that are still useful for staff reference, client questions,
  warranty follow-up, or project closeout
- preconstruction projects that staff are actively estimating or coordinating
- under-warranty projects that still need communication or service tracking
- active leads with current estimates or client communication

Operational records should be imported into Compass as editable only after they
pass review rules for identity, permissions, duplicate detection, and source
mapping.

## Identity And Access Rules

Buildertrend access is evidence, not permission by itself.

- Imported vendors/subs/suppliers should not receive portal access
  automatically.
- Vendor/sub project assignments should create staged access candidates with
  portal access off until an admin explicitly enables access.
- Customer/client contacts may be eligible for project access when their email
  matches a project access record and an owner role has been approved.
- If Buildertrend contains individual owner contacts, do not create a separate
  active concatenated owner contact such as `Travis and Tanis Loomis` or
  `Alan and Deborah Loeffler`. Preserve the combined display name as project
  metadata or archive text only.
- If Buildertrend has only a concatenated contact and no individual contacts,
  import it as a review-needed customer record rather than auto-activating a
  portal user.
- Internal users should be matched against Compass users or Google Workspace
  users before access is granted.

## Financial Data Rules

Sage remains the accounting source of truth going forward. Buildertrend
financial records are historical and reconciliation data unless an authorized
workflow promotes them.

Buildertrend estimates, lead estimates, client invoices, accounts receivable
records, and payments should be imported as:

- read-only archive records first
- searchable by project, lead, client, date, amount, status, and source number
- eligible for reconciliation against Sage only through an explicit review
  queue

Compass should not treat Buildertrend payment or invoice data as authoritative
accounting data without a Sage reconciliation status.

## Suggested Import Tables

The current Compass tables already cover many operational records, but a
full Buildertrend migration needs a durable staging layer.

Recommended additions:

- `buildertrend_import_runs`
  - run ID, started by, started at, completed at, source method, status, notes
- `buildertrend_source_records`
  - import run ID, source type, Buildertrend job/lead ID, Buildertrend record
    ID, source URL, raw JSON/text payload, normalized summary, searchable text,
    review status, and Compass promotion target
- `buildertrend_archive_files`
  - import run ID, project ID or lead ID, Buildertrend file/photo/log/message
    ID, Google Drive file ID, folder ID, file metadata, visibility, checksum,
    review status
- `buildertrend_financial_records`
  - project ID or lead ID, record type, estimate/invoice/payment number, amount,
    date, status, raw payload, Sage reconciliation status
- `buildertrend_access_candidates`
  - project ID or lead ID, contact name, email, company, Buildertrend access
    role, matched Compass contact/user, proposed Compass role, review status

These tables should protect the operational tables from messy historical data
while still letting Compass search and reconcile the full Buildertrend record.

## Import Order

1. Inventory all Buildertrend jobs, leads, completed projects, and archived
   projects with IDs, names, statuses, departments, clients, addresses, project
   managers, and direct Buildertrend URLs.
2. Match each Buildertrend job/lead to a Compass project or create a staged
   Compass project/lead candidate.
3. Create or verify Google Drive archive folders for each project or lead.
4. Capture raw Buildertrend exports and downloaded artifacts into Google Drive.
5. Import source manifests into Compass D1.
6. Deduplicate contacts and create access candidates without granting access.
7. Promote active/preconstruction/warranty operational records into Compass
   tables:
   - daily logs
   - photos
   - schedules
   - tasks
   - RFIs
   - POs
   - RFQs/RFPs
   - owner updates
   - messages
   - finish selections
8. Import financial/estimate/payment history as read-only archive records.
9. Reconcile financial records against Sage where needed.
10. Expose archive/search views for completed and archived projects once the
    source capture is trustworthy.

## Current Cloud Staging Status

As of July 7, 2026, the first Buildertrend browser-capture pass has been
imported into the remote Compass D1 staging tables.

Captured and staged:

- 128 linked Buildertrend job records from the Jobs list after selecting all
  visible Buildertrend statuses: Presale, Open, Warranty, and Closed.
- 1 deleted Buildertrend job row was preserved in the raw local snapshot but
  not linked to a Compass project shell because Buildertrend did not expose a
  job link in the grid row.
- 91 visible Buildertrend lead opportunities.
- 50 visible Buildertrend lead proposals.
- 433 visible Buildertrend client contacts.
- 8 Buildertrend report snapshots:
  - Daily log creation by job
  - Schedule percent complete by job
  - Invoicing
  - Work in progress
  - Budgeted vs projected
  - Lead activities by salesperson
  - Lead count by salesperson
  - Lead status by source

Guardrails verified:

- Buildertrend client/sub/vendor/customer access candidates remain staged as
  `not_granted` and `needs_review`.
- The all-status job import stages newly discovered project shells as `OTHER`
  rather than marking historical jobs as active. Active/warranty/complete
  classification still needs review or a richer Buildertrend export with
  per-row status.
- Raw browser snapshots and generated import SQL live in `.codex-snapshots/`
  and are intentionally gitignored.

Still required:

- Per-project captures for daily logs, photos, messages, RFIs, POs, tasks,
  schedules, owner updates, finish selections, files, estimates, invoices, and
  payments.
- Google Drive archive folder creation or verification for each imported
  project/lead.
- A project archive/search UI for staged historical records that should not be
  promoted into active Compass workflows.
- A review queue for classifying `OTHER` imported projects into active,
  warranty, complete, inactive, archive, or ignored.

## Display Model In Compass

Active and preconstruction work should appear in the normal project hub and
workflow pages.

Completed, archived, inactive, and legacy projects should appear in a historical
archive/search mode by default. Users should be able to filter by department,
status, client, year, Buildertrend source type, and record type.

Leads should not be hidden inside projects. Compass should have a lead/precon
view that can show:

- active leads
- archived leads
- lead estimates
- design/preconstruction handoff status
- conversion to a Compass project
- source records from Buildertrend and Google Drive

## Minimum Useful Pilot

Before bulk import, test the complete pattern on:

- Loomis
- Loeffler
- one active or recent Nu-Tech lead
- one completed ORC/HPS project
- one archived project with substantial files/photos/messages

The pilot should prove:

- raw source preservation in Google Drive
- D1 source manifests
- contact deduplication
- no accidental vendor/sub/client access
- owner name deduplication for individual vs concatenated contacts
- schedule/log/photo/message import
- estimate/invoice/payment archive visibility
- promotion from archive source record to operational Compass record

## Non-Goals For The First Bulk Pass

- Do not auto-grant portal access to every Buildertrend user.
- Do not make Buildertrend financials authoritative over Sage.
- Do not duplicate photos/documents into D1.
- Do not force every completed/archived record into active Compass workflow
  tables.
- Do not rewrite historical Buildertrend data to match current Compass phrasing;
  preserve provenance and show cleaned summaries separately.
