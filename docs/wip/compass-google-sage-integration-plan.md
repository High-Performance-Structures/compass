# Compass, Google Workspace, and Sage Integration Plan

Last updated: 2026-05-13

## Working Direction

Compass should become the project management shell for HPS. Google Workspace should remain the document, intake, form, and lightweight automation layer. Sage 100 Contractor should remain the accounting, job cost, purchase order, estimate, billing, and financial source of truth.

Buildertrend is the system being displaced. The transition should run Compass and Buildertrend in parallel until active project documents, daily logs, trade contacts, open RFQs, open purchase orders, and schedules have been mapped into Compass.

Security is a gating concern for this integration track. See
[Compass Security Plan](compass-security-plan-2026-05-19.md) before adding new
Google Workspace, Sage, owner/subcontractor portal, or agent write workflows.

## System Roles

### Compass

Compass should own the operational project view:

- project index and project detail pages
- project member/client/subcontractor access
- schedule view and schedule edit workflow
- project documents and photos surfaced from Google Drive
- daily logs and field reports surfaced from Google Forms/Sheets
- owner-facing project updates generated from approved daily logs and photos
- RFIs, RFQs, purchase order requests, change requests, and approvals
- agent-assisted project summaries, schedule updates, and follow-up drafting
- sync status, conflict review, and audit trail

### Google Workspace

Google Workspace should own content and lightweight intake:

- Shared Drive folder structure
- project folders, photo folders, templates, and client-visible documents
- forms for daily logs, safety incidents, client change requests, and field submissions
- sheets that still exist as transition trackers or automation tables
- Apps Script for event-driven Google-native automation when direct API work is not worth owning in Compass yet

The existing HPS Google Site and Apps Script work should be treated as a transition layer. Useful pieces can be preserved, but Compass should eventually replace the Google Site dashboard as the primary interface.

### Sage 100 Contractor

Sage should own financial, scheduling, and operational commitment records:

- jobs/projects from Sage's perspective
- job costs and cost codes
- estimates and budgets
- purchase orders and committed costs
- scheduling and task commitments as they relate to staff, subcontractors, and suppliers
- staff, subcontractor, and supplier assignment/notice context when Sage is the source of that commitment
- progress billing, invoices, payments, and payables

Compass should make those Sage records accessible per job without forcing users to work inside Sage for every project-management task. Compass should not casually write into Sage. Writes should go through explicit user actions, sync metadata, idempotency keys, and conflict review.

## Project Readability Model

Projects should not appear as a flat list of file names or job numbers. Each project card/row should summarize the project as a living workspace.

Recommended project index fields:

- project number / Sage job number
- project name
- client / owner
- address
- status
- project manager
- schedule health
- next milestone
- percent complete
- open RFIs / issues / approvals
- latest daily log date
- latest owner update date
- new photos awaiting review
- Drive folder link status
- Sage sync status

Recommended project detail sections:

- Overview: client, address, status, manager, key dates, next milestone
- Schedule: Compass Gantt/list/calendar, baseline, critical path, change history
- Documents: Drive folder, plans, specs, contracts, photos, client-visible documents
- Field: daily logs, safety incidents, weather/delay notes, photos
- Owner Updates: approved public summary, selected photos, next schedule item, next milestone, visible delays
- Financials: Sage job cost summary, estimates, POs, progress billing, invoices
- People: internal team, client contacts, subcontractors, permissions
- Activity: sync events, agent notes, decisions, audit history

Client and subcontractor views should be project-scoped. Clients should see status, milestone schedule, selected photos, approved documents, and financial summaries only when explicitly allowed. Subcontractors should see assigned project documents, relevant schedule tasks, notices, RFQs/POs, and communication for their scope.

Budget visibility is project-prefix aware. `O` jobs can expose owner-approved cost-code detail in the owner budget view. `H` jobs should show owners only the overall budget categories/divisions, while internal users still see the full Sage/G703 cost-code detail. The same pattern may later be extended for `N` and `D` work if those client-facing rules differ.

Project contacts should be project-scoped and filtered by audience: owner, supplier, subcontractor, and internal. The project contact layer should reconcile global Compass customers/vendors/users with Sage vendors, Sage job assignments, Buildertrend project contacts, Google Workspace contacts, and manually-entered project contacts. Portal access should be granted from this reconciled layer, not directly from a raw Buildertrend or Sage import.

Supplier and subcontractor contacts should also carry estimating classifications: CSI division, CSI division name, and a primary cost code when known. The relationship type answers "who are they for this job?" while CSI answers "where do they belong in estimating and budget scopes?" A company can remain a supplier/subcontractor for portal and commitment purposes while still being searchable by divisions like `03 Concrete`, `08 Openings`, `22 Plumbing`, or `26 Electrical`.

Sage and schedule contact reconciliation should be stored as source links rather than overwriting the contact itself. `project_contact_source_links` records which Sage/Compass schedule source record named which company/person, whether it matched a Compass project contact, and whether the match needs review. This gives Compass a safe queue for names such as Sage POs, Sage task assignments, Buildertrend schedule assignments, or combined schedule assignee strings before portal access or vendor IDs are treated as authoritative.

## Identity Mapping

Compass needs a canonical project identity layer that can map the same project across systems:

- `compassProjectId`
- `sageJobId`
- `sageJobNumber`
- `googleDriveFolderId`
- `googleScheduleSheetId`
- `googleDailyLogSheetId`
- `googleCalendarId` or milestone calendar mapping
- `telegramChatId` or capture-channel mapping for crew photo intake
- legacy Buildertrend project identifier, if exportable

The HPS/Compass project number is the user-facing identifier. Owners, office staff, field users, and subcontractors should be able to identify and search projects by values like `O-170-2684` and `O-202-595`; Sage IDs, Google IDs, and Buildertrend IDs are integration keys, not the primary Compass label.

Known format: `{TYPE}-{SEQUENTIAL}-{STREET_NUMBER}`. The first character in the HPS project number is a letter, not a digit. Valid prefixes are `O` for ORC/Open Range Construction, `N` for NuTech Systems, `H` for High Performance Structures, and `D` for design-only work.

This mapping should live in Compass, not in a spreadsheet. Spreadsheets can import/export it during transition, but Compass should own the canonical cross-system links.

## Sage Schedule Strategy

Sage 100 Contractor has scheduling features, including Gantt tasks, predecessor relationships, milestones, subcontractor/supplier notices, and schedule changes. Compass already has a schedule engine with tasks, dependencies, workday exceptions, baselines, critical path, and multiple views.

Decision:

1. Treat Sage as the operational schedule source.
2. Treat Compass as the readable, editable, project-facing schedule interface.
3. Do not use Google Sheets as the long-term schedule system. Existing schedule sheets can remain as legacy references or import/export artifacts during transition.
4. Begin with read-only Sage schedule/job/task import into Compass.
5. Add explicit "Push to Sage" actions only after mapping and conflict handling are proven.
6. Keep financial and commitment triggers tied to Sage records, not only Compass schedule tasks.
7. Make owner updates able to pull the next relevant schedule item from the mapped Compass/Sage schedule so clients see what is coming next, not only what happened last.

Sync directions:

- Sage to Compass: jobs, job numbers, cost codes, estimates, POs, billing, job-cost summaries, staff/sub/supplier task assignments, notices, and existing schedule tasks if available.
- Compass to Sage: schedule task edits, milestone updates, staff/sub/supplier task updates, PO requests, estimate/change request drafts, only after user confirmation.
- Google to Compass: Drive folders, document metadata, daily logs, form responses, project intake, and legacy schedule references when useful.
- Compass to Google: new project folders, copied templates, approved owner-update PDF snapshots, and archived published artifacts when needed.

## Owner Update Strategy

Owner logs should not depend on Google Docs as the primary authoring surface. Compass should store daily logs, approved photos, selected schedule items, and owner-update metadata as structured records. Compass should render the owner update as clean HTML first, then generate durable artifacts from that approved version.

Recommended path:

1. Build owner updates as live Compass HTML pages.
2. Require approval/publish status before an update is owner-visible.
3. Generate owner-facing photo previews from approved Drive/Telegram originals and serve those previews from Compass-controlled storage, while keeping "view all photos" linked to the full Drive folder.
4. Generate a PDF snapshot from the approved HTML update for Drive/project archive.
5. Generate an email preview with a short summary, next schedule item, and a clear "View full update" link.
6. Later, add actual email sending, delivery tracking, and Drive PDF creation behind the same published-update workflow.

## Agent And Search Bar Strategy

The global search/command bar should become the fastest path into the Compass agent, not only a navigation palette. Users should be able to type natural requests such as "show Loeffler POs", "what is next on Loomis", "build me a dashboard for projects waiting on owner decisions", or "find subs assigned next week". Compass should route those requests to the agent with current page/project context.

Initial behavior:

- Exact matches still navigate quickly to projects, customers, vendors, files, schedules, and dashboards.
- If the typed text is not just a simple navigation target, the command menu offers "Ask Compass" and sends the prompt to the agent panel.
- The agent should use tools before answering: project lookup, Sage schedule/task/PO lookup, Google Drive lookup, daily-log/photo lookup, and dashboard rendering.
- Dashboard customization should be agent-led: the user describes what they want to see, the agent queries the relevant records, renders a dashboard, and offers to save it.
- Sub-agent style behavior should be represented as scoped internal workflows, such as "schedule analyst", "Sage reconciliation", "owner update drafter", and "dashboard builder", even if the first implementation is one agent routing tools under the hood.

## Apps Script Reuse

The prior Google Site plan called for Apps Script around:

- project intake form to folder creation
- automatic numbering from the Developer-folder Project Registry
- tracker updates on submit
- installable form-submit triggers
- insurance expiration alerts
- daily log summaries
- schedule updates to Sheets and Calendar

Best reuse:

- Keep Apps Script for Google-native event triggers, especially form-submit and spreadsheet-change workflows.
- Move business rules and permission decisions into Compass when they affect project access, Sage writes, or client/subcontractor visibility.
- Prefer direct Google Drive/Sheets/Calendar APIs from Compass for user-initiated actions.
- Use Apps Script only as a bridge when the trigger lives naturally in Google Workspace.
- Treat Telegram/photo intake as an inbound capture source, not as the owner-facing system of record. Photos should land in Compass/Drive for review before they become owner-visible.

Apps Script access still depends on Google Admin OAuth scopes. The known required scopes include Apps Script project/process scopes in addition to Drive/Sheets/Form scopes.

Current Compass bridge endpoints:

- `/api/google/project-manager-handoff` is the dedicated HPS Project Manager receiver. It creates or updates the Compass project, maps the Drive folder, and stages Sage job review.
- Compass-native project intake must dual-write the `________Developer` Project Registry and the matching department tracker. The legacy `Project Lead Tracking` workbook is prohibited as a destination for new records.
- Project Manager handoffs should use the active tracker spreadsheets in the `________Developer` Google Drive folder: ORC Tracker, HPS Tracker, Nu-Tech Tracker, and Design Tracker. ORC and Design currently expose a full `Address` column; HPS and Nu-Tech expose `Project Address`. Compass accepts those raw tracker headers directly, plus normalized names such as `address`, `projectAddress`, and `jobsiteAddress`.
- The Developer folder also contains the protected `Copy of Contract Package Template`, `Finish Schedule Form Responses`, and `Finish Schedule Generator` workflow assets. Generated finish schedules must carry a project number and remain discoverable from the matching Compass project; reconciliation should report response rows or generated workbooks without a Compass mapping.
- When a tracker or script sends split address fields, Compass also accepts `streetAddress`, `addressLine1`, `city`, `state`, `zip`, the Project Manager form names `streetNum`, `streetName`, and `cityState`, and raw sheet headers such as `PROJECT STREET NUMBER`, `PROJECT STREET NAME`, and `City, State Zip`. Zip code is captured when it is included in `Address`/`Project Address`/`City, State Zip` or sent separately as `zip`/`zipCode`; older rows that only contain city should be cleaned up or flagged as incomplete address data. Compass composes those fields into `projects.address` and will not erase an existing address when a later handoff omits address data.
- `/api/google/script-handoff` is the generic receiver for the remaining Google scripts. The first target scripts are HPS Project Intake Automation, Nu-Tech PO Order Manager, and the Design-owned Finish Schedule Generator. Each request must include a bearer token and a project number so Compass can attach the handoff to the correct project.

Generic script handoff payloads should include:

- `source`: stable script key such as `hps_project_intake`, `nutech_po_order_manager`, or `finish_schedule_generator`.
- `projectNumber`: Compass project number using the department-letter prefix.
- `title`, `description`, `action`, `handoffId`, and `occurredAt` when available.
- Optional workflow fields such as `companyName`, `assigneeName`, `amount`, `dueDate`, `externalUrl`, and source-specific row data. Compass stores the raw payload for review and later Sage mapping.

## First Implementation Track

### Phase 1: Project Registry

- Extend project schema with external identifiers for Sage, Google, Buildertrend, owner update cadence, and owner update channel.
- Add a project-source mapping table so multiple systems can link to one project.
- Build a project import/reconciliation screen that shows Compass, Sage, Google Drive, and Buildertrend/exported identifiers side by side.
- Add project health/status fields needed for the readable project index.

Initial implementation started:

- `projects` now has canonical registry fields for Compass project number, Sage job ID/number, Google Drive folder, Google schedule sheet, Google daily log sheet, Google calendar, Buildertrend ID, owner update status/channel/cadence.
- `project_external_links` stores normalized external mappings including Sage, Google Drive, Google schedule, daily logs, calendar, Buildertrend, and Telegram owner-update/photo intake.
- Project detail pages include a Project Registry panel for editing those IDs before deeper sync work begins.
- The first field-documentation slice is in place:
  - `daily_logs` stores Compass, Google Forms/Sheets, Buildertrend, or imported daily logs against a canonical Compass project.
  - `daily_log_photos` stores project photos, including staged Telegram/mobile uploads that have not yet been attached to a specific daily log.
  - `daily_log_task_links` can connect daily logs to schedule tasks worked on that day.
  - `owner_project_updates` stores draft, approved, published, or sent owner-facing updates generated from approved logs and reviewed photos.
  - Project detail pages include a Field Updates panel showing daily log, photo review, and owner update readiness.
  - Sample owner update photo previews for Loomis and Loeffler now render from Compass-local preview files instead of authenticated Google download URLs.
- The first Sage operations slice is in place:
  - `project_operations` stores Sage-sourced POs, staff tasks, subcontractor tasks, supplier tasks, and schedule commitments against the Compass project.
  - Project detail pages include a Sage Operations panel showing open PO count/value, active staff/sub/supplier commitments, and the next schedule item.
  - Owner update panels can display the next schedule item alongside the latest approved field update so the client-facing update can say what is coming next.
- Buildertrend archive first pass started on 2026-05-13:
  - Loeffler (`O-202-595`, Sage `722`, Buildertrend `41684371`) now has a Google Workspace `Buildertrend Archive` folder with a full daily-log PDF and one archived daily-log photo ZIP.
  - Loomis (`O-170-2684`, Sage `620`, Buildertrend `35400494`) now has a Google Workspace `Buildertrend Archive` folder with a full daily-log PDF and four archived daily-log photo ZIPs: floor system, flashing, bracing/finish grading, and top plate/beams.
  - Loomis Buildertrend photo ZIPs are unpacked into adjacent `Unzipped photos` review folders; ZIPs remain source archives, while Compass review records should point to individual images or Compass-managed previews.
  - The 50 unzipped Loomis Buildertrend photos were also copied to `Pictures/May 2026/Buildertrend Review Photos` and mapped in Compass as the `Buildertrend photo review` connected source.
  - Local Compass demo data has Buildertrend project IDs mapped for both jobs, plus imported Buildertrend daily-log/photo records marked `needs_review` and not owner-visible.
  - Four Loomis Buildertrend preview candidates now render from Compass-local thumbnail files in the field panel, while their source ZIP archives remain internal review material.

### Phase 2: Google Workspace Connection

- Complete Google Drive setup through the existing service account/domain-wide delegation module.
- Add project folder linking and folder creation from Compass.
- Add Drive folder and photo folder widgets to project detail pages.
- Add daily log form/sheet ingestion as read-only first.
- Add a "New Project Setup" action that creates the folder set, copies templates, and records IDs in Compass.

### Phase 3: Sage Connector

- Create a Sage module parallel to the existing NetSuite module rather than mixing Sage into NetSuite names.
- Reuse the proven sync concepts: auth storage, rate limiting, mappers, sync metadata, sync log, conflict strategy, idempotency keys.
- Start with read-only jobs, cost codes, estimates, POs, invoices/progress billing, and schedule data.
- Add explicit write actions after project/job matching and conflict review are reliable.

Initial bridge placement started on 2026-05-14:

- Sage access belongs server-side, not in the browser. Compass should read Sage through a dedicated Sage bridge module, normalize records into Compass tables, and let the UI/agent query Compass read models.
- The current working evidence points to Sage 100 Contractor backed by SQL Server reachable over the private Tailscale network. The prior connection troubleshooting centered on SQL Server TCP access, fixed/named-instance ports, and keeping access limited to Tailscale rather than the public internet.
- The Compass config contract is environment/secret backed: `SAGE_SQL_SERVER`, `SAGE_SQL_DATABASE`, `SAGE_SQL_USER`, `SAGE_SQL_PASSWORD`, plus optional `SAGE_SQL_PORT`, `SAGE_SQL_INSTANCE`, `SAGE_SQL_ENCRYPT`, and `SAGE_READ_ONLY`.
- The operational dashboard now has a Sage API bridge status row that shows whether the server/database credentials are loaded, whether the bridge is read-only, how many projects have Sage mapping, how many Sage operation records are present in Compass, and when the latest Sage operation sync was recorded.
- The bridge should initially hydrate `projects`, `project_external_links`, `project_operations`, `schedule_tasks`, and later financial read-model tables. Live Sage writes remain out of scope until confirmation, idempotency, conflict review, and audit logging are visible in Compass.

Known Sage table/workflow hints from the migration trail:

- Jobs and job phases map through `actrec` / `jobphs`.
- A/P invoice workflows use `acpinv` / `apivln`.
- A/R invoice, receipt, and deposit workflows use `acrinv` / `acrpmt` / `actrec`.
- Equipment work has its own `eqpmnt` workflow.
- Cash/card activity should be reconciled through the proper Sage cash/card workflow rather than forced through a generic GL import.

### Phase 4: Project Access

- Expand project membership into clear access roles: internal admin, office, field, client, subcontractor.
- Add project-scoped document visibility rules.
- Add client/subcontractor portal views inside Compass.
- Preserve Google Workspace permissions as the lower-level enforcement layer for files.

### Phase 5: Agent Integration

- Add agent tools for project lookup, schedule update proposals, Drive folder summaries, Sage job-cost summaries, and sync health.
- Add agent tools for Sage POs, staff/sub/supplier commitments, next schedule item, and owner update drafting.
- Require user confirmation before any Sage write, external notification, sharing change, or client/subcontractor-visible update.
- Give the agent a project context panel so it can help manage the project without requiring users to know where every record lives.

## Open Questions

- Confirm exact Sage product/version and enabled API surface. Current evidence points to Sage 100 Contractor SQL.
- Confirm whether Sage schedule data can be reliably read and written through the API for the fields HPS actually uses.
- Confirm the active project list and which 2-3 projects should become pilots.
- Confirm whether Google Site should remain client-facing during transition or be replaced by Compass client portals quickly.
- Confirm where reusable credentials should live. Do not commit them to the repo; use environment secrets or a secrets manager.
