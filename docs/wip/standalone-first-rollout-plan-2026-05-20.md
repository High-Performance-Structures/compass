# Compass Standalone-First Rollout Plan

## Principle

Compass should be usable as a stand-alone construction project management tool before any accounting, ERP, Google Workspace, Telegram, or migration connector is configured.

Integrations remain important, but they should enhance Compass records instead of being required to create, view, edit, print, email, or complete core workflows.

For HPS, this is also a business-continuity requirement. If Sage is unavailable during the workday because of a network issue, server issue, power outage, failed UPS backup, VPN/Tailscale interruption, or accounting-system maintenance, staff should still be able to work inside Compass. Compass should keep capturing operational records and queue accounting sync for later rather than blocking field, office, owner, or vendor workflows.

The preferred pattern is:

1. Create and own the Compass record.
2. Store optional integration identifiers on that record.
3. Display sync status as supporting context.
4. Require explicit confirmation before writing to Sage or any external system.
5. Preserve audit history for external sends, syncs, and visibility changes.

## Sync Outage Mode

Compass should treat integration outages as degraded sync, not application failure.

During a Sage/accounting outage, staff should still be able to:

- create and update projects, contacts, RFIs, P.O.s, daily logs, photos, owner updates, tasks, and schedules
- print pickup copies
- email suppliers, owners, subcontractors, and internal users through Compass
- record bills, draw/pay-app preparation notes, and budget changes as Compass drafts
- continue messaging and notifications
- see the most recent synced accounting snapshot with a visible timestamp

Compass should clearly label records created during an outage:

- `Compass only`
- `Pending accounting sync`
- `Needs review before sync`
- `Sync conflict`
- `Synced`

When the accounting system is available again, Compass should support a scheduled or manual reconciliation run:

1. Read the latest external system state.
2. Compare queued Compass changes against external records.
3. Show additions, updates, conflicts, and skipped records.
4. Let an authorized user approve writes.
5. Write changes with idempotency keys and audit logs.
6. Mark records as synced, conflicted, or held for review.

This keeps the office working during an outage while still protecting Sage from blind writes after systems come back online.

Pre-alpha minimum:

- Compass-native P.O.s, RFIs, logs, photos, messages, schedules, and owner updates must not depend on live Sage availability.
- The dashboard should show whether accounting sync is healthy, stale, or unavailable.
- Records with pending external sync should remain usable in Compass.
- Any post-outage accounting write should require explicit confirmation.

## Shared Data Directory Model

Compass needs a product-level data directory that can be populated several ways:

- Manual entry in Compass.
- Spreadsheet import.
- Sage sync for HPS.
- Future accounting/ERP syncs such as QuickBooks, Foundation, Buildertrend exports, or other contractor systems.

The data people need repeatedly should not be trapped inside one integration. Compass should own normalized records for:

- customers and owners
- vendors, suppliers, subcontractors, consultants, governmental agencies, and internal departments
- employees/internal users and project roles
- cost codes and CSI divisions
- accounting/job cost accounts
- tax groups and common billing/payment terms
- standard schedule phases/templates
- common RFI, RFQ, P.O., daily-log, and owner-update templates

Each record should carry source metadata:

- `sourceSystem`: manual, spreadsheet, sage, buildertrend, google, quickbooks, etc.
- `sourceRecordId` / `sourceRecordNumber`: optional external identifier
- `syncStatus`: manual, imported, synced, needs_review, conflict, archived
- `lastSyncedAt`: optional timestamp

Spreadsheet imports should land in a review queue before becoming trusted project data. The import workflow should support:

- upload or paste spreadsheet data
- map columns to Compass fields
- preview additions, updates, duplicates, and conflicts
- choose create/update/ignore
- preserve the original source row for audit/debugging

This lets a small contractor start with a spreadsheet, HPS start with Sage, and future customers connect whatever system they already use.

## Component Requirements

### Projects

Standalone behavior:
- Create and manage projects using Compass project number, name, client, department, status, address, and team.
- Department and status filtering should work without Sage, Google Drive, or Buildertrend mapping.
- Project number remains the user-facing identifier.
- Customers, departments, project statuses, and project roles can be selected from Compass data directories or typed manually before directories are complete.

Integration behavior:
- Sage job ID/number, Google Drive folder ID, Buildertrend ID, and calendar IDs are optional registry fields.
- Admin/developer mode can expose mapping and reconciliation controls.
- Worker mode should keep integration IDs out of the main workflow unless action is required.

Current next steps:
- Add a Compass-native "New Project" path from the project hub.
- Keep project registry visible only in admin/developer mode.
- Rename UI language from "Sage linked" to "Accounting linked" where the concept is product-generic.
- Add spreadsheet import for historical projects and project status cleanup.

### Contacts

Standalone behavior:
- Maintain global Customers, Vendors, and Internal contacts inside Compass.
- Assign contacts to projects with role, trade, CSI category, visibility, and active status.
- Owners/subs/vendors should receive portal permissions from Compass project-contact assignments, not raw external records.
- Contacts can be created manually or imported from spreadsheets before any accounting sync is connected.

Integration behavior:
- Sage, Buildertrend, Google, or CSV imports should create reviewable source links.
- Imports should not automatically grant project access.
- Source records can be matched, ignored, corrected, or used to create new Compass contacts.

Current next steps:
- Keep contact category cleanup product-generic: customer, vendor, internal, governmental agency, building/planning department, supplier, subcontractor, consultant, miscellaneous vendor.
- Add duplicate detection before creating new vendors from imports.
- Add spreadsheet import with category drop-down mapping and duplicate review.

### Purchase Orders

Standalone behavior:
- Create multi-line P.O.s in Compass.
- Print a pickup copy.
- Email a supplier-ready copy from Compass.
- Track status, vendor, project, dates, line items, totals, and internal owner without Sage.
- Vendors, cost codes, phases, tax groups, and shipping/pickup locations should be selectable from Compass directories while still allowing typed values.

Integration behavior:
- Sage vendor ID, job ID, phase, cost code, tax group, and write status remain optional sync fields.
- Approved P.O.s can later be pushed to Sage with confirmation and audit logging.

Current status:
- P.O.s are now Compass-native in the UI.
- Supplier email and pickup print are available without Sage.
- Accounting sync information is secondary.

Current next steps:
- Add sent-email audit history visible on the P.O.
- Add PDF attachment generation for supplier emails.
- Add explicit "Push to Sage" only after conflict/idempotency rules are visible.
- Replace free-text cost code fields with typeahead selectors backed by the Compass cost-code directory, while preserving free-text fallback.

### RFIs

Standalone behavior:
- Create, assign, respond to, attach files/photos, and update RFI status entirely in Compass.
- Project context must be clear and switchable without accidental cross-project creation.
- Assigned/requested-by fields should accept project contacts or typed names.

Integration behavior:
- External systems may import or export RFI context later, but RFIs do not depend on accounting software.

Current next steps:
- Add notification preference routing for assigned users/contacts.
- Add response history and attachment preview polish.
- Add print/export view if staff need a formal RFI packet.

### Schedules / Calendar

Standalone behavior:
- Compass must support project schedules, tasks, milestones, dependencies, assignees, and calendar/task views without Sage.
- Work Calendar should show cross-project tasks and appointments.
- Project schedules should support edits from Compass.

Integration behavior:
- Sage can be an operational schedule source for HPS.
- Sage imports should hydrate Compass schedule records.
- Sage writes should be explicit and reviewed.

Current next steps:
- Label schedule data by source: Compass, Sage, Buildertrend import, manual.
- Add "needs sync" and "source locked" states for tasks that should not be silently overwritten.
- Keep Google Sheets schedules as import/reference helpers, not the long-term source.

### Daily Logs And Photos

Standalone behavior:
- Field users can submit logs/photos directly to Compass.
- Photos can be tagged internal, owner-visible, sub/vendor-visible, or restricted.
- Staff can filter by date, job, visibility, uploader, and log association.

Integration behavior:
- Telegram, Google Drive, and Buildertrend archives can feed into the Compass photo/log library.
- External folder links should not be exposed to owners/subs; they should see Compass-rendered galleries only.

Current next steps:
- Build upload/intake paths that do not require Google Drive.
- Add owner/sub-safe photo gallery views.
- Add audit history when visibility changes.

### Owner Updates

Standalone behavior:
- Draft owner updates from daily logs, schedule context, and approved photos inside Compass.
- Publish an owner-facing HTML update.
- Provide copy link, save PDF, and email preview/send paths.

Integration behavior:
- Google Docs are optional exports, not the source format.
- Email provider and messaging tools can distribute updates.

Current next steps:
- Add approved-publish workflow with immutable published snapshots.
- Add social/share controls only for approved owner-visible photos.
- Add email send audit and recipient tracking.

### Messages / Notifications

Standalone behavior:
- Compass supports project messages, channels, notifications, and role/project contact targeting.
- Users can message within a project without external chat tools.

Integration behavior:
- Email, text, Telegram, and push are delivery channels.
- Delivery preferences belong to Compass user/contact settings.

Current next steps:
- Add recipient selection polish and visible delivery status.
- Add external contact message routing where no Compass login exists yet.
- Add notification audit for P.O.s, RFIs, owner updates, and schedule changes.

### Budget / Financials

Standalone behavior:
- Compass can show budget/SOV lines, owner-safe views, commitments, bills, and pay application preparation without Sage.
- H jobs and O jobs keep their different owner visibility rules.
- Cost codes, accounts, SOV lines, and budget categories can be entered manually or imported by spreadsheet.

Integration behavior:
- Sage remains HPS's accounting source of truth for job cost, billing, estimates, P.O.s, and payments.
- Compass budget records should carry optional source metadata and sync status.

Current status:
- Budget rollups now default to Compass source when no external source is known.

Current next steps:
- Add Compass-native budget/SOV import or manual entry path.
- Add Sage-backed actuals as source-labeled read models.
- Keep owner budget presentation independent of Sage availability.
- Add company-level cost-code/account directory tables before broad budget import.

### Dashboard / Roles / Permissions

Standalone behavior:
- Role-specific dashboards and preview modes work from Compass permissions alone.
- Admin/developer mode exposes build-out, registry, integration, and sync details.
- Worker mode hides development and raw integration details.

Integration behavior:
- Sage permissions should cap what integrated Sage data/actions a user can see or perform.
- Compass permissions remain the front-door access model.

Current next steps:
- Continue building the role/view matrix spreadsheet.
- Add permission gates around every external write, owner-visible publish, and supplier send.

## Rollout Definition Of Done

For every feature before pre-alpha:

- It has a Compass-native create/view/edit path.
- It does not require Sage or Google Workspace to function.
- Integration IDs are optional.
- Missing integration configuration produces helpful "not connected" copy, not broken UI.
- External writes require explicit confirmation.
- Owner/sub/vendor visibility is rendered through Compass, not direct external links.
- Important sends/publishes/syncs leave an audit trail.
