# 2. Capabilities by area

Each area below follows the same pattern: purpose, key screens, rules enforced in code, integrations, and the main tables and modules. Routes are under `src/app/` and components under `src/components/`. Every table is described in full in Appendix A, and every action and route is listed in Appendix B.

A note on shared plumbing: to-dos, RFQs, purchase orders, pay-application mirrors and accounting handoffs are all rows in one table, `project_operations`. The `source_record_type` column tells them apart. Most user-facing writes also add an Activity row through `recordActivityEvent` (`src/lib/activity-log.ts`).

## 2.1 Projects and pipeline

**Purpose.** A project is one client job, or an internal workspace, that belongs to one organization and one department. Compass handles:

- intake and job numbering;
- job status and the sales pipeline;
- linked jobs across departments and families of phased jobs;
- saved hub views;
- owner and vendor visibility;
- archives and templates.

**Key screens.**

- The project hub: `dashboard/projects/page.tsx`, with bulk selection and saved views.
- The project workspace: `dashboard/projects/[id]/` (overview, information and every module tab).
- The audience previews: `projects/[id]/preview/owner` and `preview/sub-vendor`.
- The follow-up list: `projects/follow-up`.
- Templates: `dashboard/templates`.
- The sales-pipeline board: `components/dashboard/sales-pipeline/`.

**Rules.**

- **Departments.** Every project has a department code (`projects.department`). There are four built-in departments: construction, home services, product sales and design. Each department has a display profile in Settings (names, sender mailbox, logo, legal details; `src/lib/department-profiles.ts`), and each can be switched on or off per company. Projects with no department use `UNASSIGNED` (`src/lib/domain/project/rules.ts`).
- **Job numbers.** Numbers follow a configurable prefix pattern: the department prefix, a sequence, a site suffix and an optional phase suffix, for example `O-07-1450` and its phase `O-07-1450-1` (`src/lib/project-profile.ts`).
  - The next number is max(sequence) + 1. The maximum is taken across Compass projects, number reservations, retired numbers and the company's external job trackers.
  - Numbers are reserved and never reused (`project_number_reservations`, `project_number_retirements`). Uniqueness is enforced by indexes on (organization, number).
  - A unique-index collision is reported as "sequence conflict, resubmit" (`src/lib/domain/project/intake.ts`).
  - Aliases keep old numbers resolvable (`project_number_aliases`, `project_route_aliases`).
- **Job status.** A built-in list of about 35 statuses, `PROJECT_JOB_STATUS_DEFINITIONS` in `src/lib/project-profile.ts`, runs from intake and estimating through contract, under construction and punch list to warranty, complete, closed and inactive. Companies can add their own statuses (`project_job_statuses`).
  - Each status has a follow-up cadence in days, which drives the follow-up list and aging.
  - Status changes are manual. They are made by `changeProjectJobStatus` (`src/lib/domain/project/job-status.ts`), which writes a project-audit row in the same batch and refuses demo accounts. Bulk changes go through `project-bulk-status.ts`.
- **Leads.** `projects.client_status` is `lead` or `customer`.
- **Sales pipeline.** The product sales department has a stage board (`src/lib/sales-pipeline/stages.ts`): intake, pricing, estimating, estimate sent, following up, awaiting payment, ordered, rentals out. Each stage groups job statuses, so moving a card sets a job status and the stage is always derived from the status.
- **Visibility.** Internal staff in the owning organization see every project. Everyone else needs a `project_members` row (`src/lib/project-access.ts`). The registry hides merged duplicates, removed rows and route-aliased projects through one filter, `activeRegistryProject()`. Each project's portfolio-map visibility is `default`, `shown` or `hidden`.
- **Linked jobs and families.** See section 6.9.
  - `project_links` ties jobs for the same customer and site across departments (one row per pair).
  - `project_families` and `project_family_phases` group phased work under one base number. Family management is admin-only (`src/lib/domain/families/access.ts`).
- **Saved views.** Views are `personal` or `shared`. Each holds a department filter plus a status bucket or a specific status (`src/lib/project-views.ts`). Search always crosses filters. Views are stored in the consolidated `saved_views` table (scope `projects`) while the legacy `project_saved_views` table is still written in the same batch; section 5.3 describes the dual-write and the read fallback.
- **All Projects loading.** The hub (`dashboard/projects/page.tsx`) waits only for intake assignees, the internal department name and saved views. The dashboard overview, the duplicate scan and the number-review exceptions start at once but reach the client as promises, so the list renders first and the card health line, next step and photo fill in inside small `<Suspense>` boundaries. Section 10.2 has the measurements.
- **Templates.** `project_templates` with versions, modules and content items. Applying a template is recorded in `project_template_applications` (`src/lib/domain/templates/`).

**Integrations.**

- The shared drive: a project folder is provisioned at intake from department template folders (`src/lib/domain/project/drive-provisioning.ts`).
- External job-tracker spreadsheets: the registry and department trackers (`src/lib/google/project-intake-tracker.ts`).
- The accounting bridge: an "ensure client and job" handoff (section 6.1).
- Geocoding and elevation for the map and for travel-zone charges.

**Tables.** `projects`, `project_members`, `project_access_invitations`, `project_job_statuses`, `project_number_reservations`, `project_number_aliases`, `project_number_retirements`, `project_route_aliases`, `project_registry_removals`, `project_duplicate_decisions`, `project_saved_views`, `saved_views`, `saved_view_defaults`, `project_profile_audit_events`, `project_links`, `project_families`, `project_family_phases`, `project_archive_documents`, `project_templates*`.

**Modules.**

- Domain modules: `src/lib/domain/project/`, `src/lib/domain/families/` and `src/lib/domain/templates/`.
- Actions: `projects.ts`, `project-registry.ts`, `project-bulk-status.ts`, `project-families.ts`, `project-links.ts`, `project-views.ts`, `project-archives.ts` and `project-templates.ts`.

## 2.2 Estimates, change orders and contracts

**Purpose.** Staff do four things in this area:

- build versioned estimates from lines, cost items and reusable assemblies;
- price them from vendor bids;
- send them for signature;
- accept them.

Acceptance rebuilds the contract budget. Later changes go through change orders. Contract packets bundle documents for signature. Deposits are requested and received, and trade letters (letters of intent and awards) commit scope to vendors.

**Key screens.**

- `projects/[id]/estimate`, plus the side-by-side `estimate/compare`.
- `projects/[id]/change-orders` and `change-orders/[changeOrderId]`.
- `projects/[id]/contracts`.
- Components: `components/projects/estimate-workspace/`, `estimate-pricing-board.tsx`, `project-change-order-create-form.tsx` and `deposit-request-dialog.tsx`.

**Rules.**

- **Estimate status.** Statuses are `draft`, `internal_review`, `signature_pending`, `accepted`, `superseded` and `void` (`src/lib/domain/estimates/rules.ts`).
  - Lines can be edited only in `draft` or `internal_review`.
  - A partial unique index allows one accepted version per (project, estimate number).
  - The e-signature status and the accounting status are tracked separately (`foxit_status`, `sage_status`).
- **Money math.** These are pure functions in `rules.ts`, shared by the browser preview and the server. All amounts are integer cents.
  - Line direct cost = quantity × unit cost.
  - Markup is a percentage of direct cost, held in basis points.
  - Tax applies to direct cost plus markup on taxable lines.
  - A builder fee (overhead, margin and contingency rates) applies to the lines that opt in.
  - Rates are clamped to 0 to 1,000,000 basis points.
- **Estimate modes per department.** The mode is a setting.
  - `single`: one contract estimate per job. A new estimate is a new version.
  - `multiple`: several separately numbered estimates (`<job>-01`, `-02`) and no contract budget. This is the default for the product sales department (`src/lib/estimates/estimate-modes.ts`).
- **Acceptance.** Acceptance is recorded by the e-sign webhook, or manually with an attestation and evidence (wet signature or another e-signature tool, up to 50 MB; `src/lib/estimates/manual-acceptance.ts`). Accepting an estimate does all of the following:
  - supersedes older versions;
  - marks the estimate ready for accounting;
  - executes a linked change order;
  - completes a phase proposal;
  - rebuilds the contract budget.

  A new version of an already-accepted contract must be accepted either as a *difference change order* or as a *replace contract* (rebaseline). Either way, a change order records the change (section 6.1).
- **Phase proposals.** An assembly of the contract estimate can be offered as a later phase. Accepting it moves the assembly out of the contract, and drafts a deduct change order if the contract is already signed (`src/lib/estimates/phase-proposals.ts`).
- **Pricing board.** RFQs match estimate lines by cost code. An approved bid can be imported into a draft estimate once (`project_rfq_bid_approvals`, `project_estimate_rfq_bid_imports`). Assemblies can be copied into another job and repriced at the target's markup.
- **Change orders.** Statuses run `draft`, `submitted`, `triage`, `needs_information`, `pricing`, `internal_review`, `approved_for_owner`, `signature_pending`, `executed`, `sage_pending`, `synced`, `closed`, with `declined` and `void` as exits. Transitions come from a fixed table (`src/lib/change-orders/status.ts`; diagram in section 6.2).
  - Kinds are `estimate`, `description`, `replacement` and `contract_version` (system-only).
  - Numbers are `<job>-CO-NNN`.
  - Change orders are voided, never deleted.
  - Owners see a change order only when its audience is `owner` and its status is published (`src/lib/change-orders/access.ts`).
- **Contract packets.** Statuses run `draft`, `internal_review`, `signature_pending`, `executed`. Manual execution needs an attestation, an https evidence link and a date that is not in the future. Only an executed packet's document can be replaced.
- **Deposits.** Statuses are `requested`, `received` and `void`, in cents. A received amount cannot drop below what pay applications have already applied.
- **Trade letters.** Kinds are `intent` and `award`, numbered `LOI-NNNN` and `AW-NNNN`. Statuses are `draft`, `preparing`, `sent`, `signed`, `declined` and `cancelled`, moved by e-sign events. The signed copy is filed in the vendor's folder.
- **Access.** Reading needs `budget` read. Editing needs `budget` update and an internal staff role (`src/lib/domain/estimates/access.ts`).

**Integrations.**

- The e-signature adapter (webhook `api/integrations/foxit/webhook`).
- The shared drive, for basis documents, executed documents and text templates.
- Accounting tax entities and cost codes.
- Takeoff-file and legacy-system estimate imports (`src/lib/estimates/*-import.ts`).

**Tables.** `project_estimates`, `project_estimate_lines`, `project_estimate_line_cost_items`, `project_estimate_assemblies`, `project_phase_proposals`, `project_estimate_acknowledgements`, `project_estimate_basis_documents`, `project_contract_budget_revisions`, `project_contract_budget_lines`, `project_change_orders`, `project_change_order_lines`, `project_change_order_documents`, `project_change_order_history`, `project_contract_deposits`, `contract_document_templates`, `contract_packets`, `trade_letters`.

**Modules.**

- Libraries: `src/lib/domain/estimates/`, `src/lib/estimates/`, `src/lib/change-orders/`, `src/lib/contracts/` and `src/lib/domain/trade-letters/`.
- Actions: `project-estimates.ts`, `estimate-*.ts`, `project-change-orders.ts`, `contract-packets.ts`, `project-contract-deposits.ts` and `trade-letters.ts`.

## 2.3 Schedule

**Purpose.** Each project has a schedule of tasks with:

- workday durations;
- dependencies and a critical path;
- baselines;
- company and project workday exceptions.

Schedules are published as snapshots to owners and vendors, and assignees confirm their dates or propose changes.

**Key screens.** `projects/[id]/schedule` and the cross-project `dashboard/schedule`, with Gantt, list, calendar and baseline views. Components are in `components/schedule/`.

**Rules.**

- **Tasks.** Status is `PENDING`, `IN_PROGRESS`, `COMPLETE` or `BLOCKED`. Phases come from a configurable list (`schedule_phase_options`). Dependency types are `FS`, `SS`, `FF` and `SF`.
- **Critical path.** The critical path uses CPM over finish-to-start links (`src/lib/schedule/critical-path.ts`). Cycles and self-links are rejected (`dependency-validation.ts`).
- **Moving dates.** Moving a task pushes its successors and shifts the linked to-dos (`src/lib/domain/schedule/store.ts`). After the first publication, a shift requires a reason, which is recorded (`src/lib/schedule/shift-tracking.ts`).
- **Workdays.** Weekends are non-working. Exceptions are `non_working` or `working`, with a category (holiday, vacation, weather day, extra workday) and a recurrence of one-time or yearly (`src/lib/schedule/business-days.ts`).
- **Publication.** Only staff publish. The snapshot holds tasks, assignees, dependencies and exceptions. Unpublished changes are found by diffing against the last snapshot.
- **Confirmations.** Statuses are `not_requested`, `pending`, `unavailable`, `proposed`, `confirmed` and `declined` (`src/lib/schedule/confirmation.ts`). Only the external assignee responds. Staff accept or reject proposals.
- **Assignees.** A schedule item can be assigned to several people, and all of them are equal: there is no lead or helper role.
  - **Storage.** Each person is a `schedule_task_people` row (`position`, a `display_name` snapshot, and an optional `assigned_user_id` and `project_contact_id`), unique on `(schedule_task_id, display_name)`. The picker also offers typed names and directory customers or vendors, which have no account to point at, so the name is kept as a named snapshot. `src/lib/domain/schedule/store.ts` is the only writer.
  - **Dual-write.** In the same `db.batch`, `schedule_tasks.assigned_to` keeps every name joined with ", ", and `assigned_user_id` keeps the first linked account. Readers that already split `assigned_to` on commas (conflicts, the daily plan, the personal calendar, print, CSV, the Work Calendar, owner updates and Field Mode) see everyone without changes.
  - **Safety net.** Readers use the people rows only while their joined names still equal `assigned_to`; otherwise they fall back to the single stored name. Writers that set only `assigned_to` (template application, older imports, the agent API and CSV import) therefore never show stale people.
  - **Form and list.** `ScheduleAssigneesField` is a multi-select with a cap of 25 (`MAX_SCHEDULE_ASSIGNEES`). The list view shows avatars plus "+N". The people filter and "My items" match any one of an item's people. Bulk assign replaces the people with the one chosen name. Follow-up to-dos and Gantt crew grouping use the first person, because a to-do has a single assignee.
  - **Notifications.** Publication snapshots record `assigneeUserIds`. On publish, each newly added linked account gets one `schedule.assigned` notice (in-app, email and push) through `src/lib/domain/schedule/assignment-notices.ts`, plus one Activity entry; the manual resend tells every published assignee. Daily-log reminders count every linked person on an open item as "scheduled today".
  - **Limits.** Owner and vendor commitment confirmation is still one task-level response, from `assigned_user_id` (the first linked person), and the confirmation reminder goes to that account. Weather-risk notices also name only the first person as the owner; job staff are notified as before.
  - **Not the same as `schedule_task_assignees`.** That older table holds reviewed, imported source participants, each with its own response authority, and it drives the publication-gated per-participant response flow. Staff picks are not written there.
- **Visibility.** Each task's visibility to owners and vendors is set separately.

**Integrations.**

- Weather risk on upcoming outdoor work (`src/lib/weather/schedule-risk-server.ts`).
- Personal and project calendar sync (section 2.8).
- Template import and export.

**Tables.** `schedule_tasks`, `task_dependencies`, `schedule_task_people`, `schedule_task_assignees`, `schedule_task_links`, `schedule_baselines`, `schedule_publications`, `workday_exceptions`, `schedule_phase_options`, `schedule_saved_views`, `schedule_template_items`, `schedule_template_dependencies`, `weather_schedule_risks`.

**Modules.**

- Libraries: `src/lib/schedule/` and `src/lib/domain/schedule/`.
- Actions: `schedule*.ts`, `baselines.ts` and `workday-exceptions.ts`.

## 2.4 Daily logs and photos

**Purpose.** The field records each day: work done, crew, hours by cost code, weather, issues and visitors. A log also updates to-dos and can create new ones (section 6.5). Photos are reviewed and released per audience. Owner updates are drafted from logs and photos, then published or recalled.

**Key screens.**

- `projects/[id]/daily-logs`, `projects/[id]/photos` and `projects/[id]/owner-updates`.
- Field Mode: `dashboard/field` on the web, plus the native shell in section 2.14.

**Rules.**

- **Log review.** Status is `draft`, `needs_review`, `approved` or `rejected`. Editing a log sends it back to review (`src/lib/domain/field/daily-logs.ts`).
- **Hours.** When cost-code labor lines exist, the log's hours are their sum.
- **Native retries.** Retries are idempotent because the native client's `clientSubmissionId` is used as the log id.
- **Photos.** Review status is `approved`, `needs_review` or `rejected`. Kind is progress, issue, delivery, selection or archive. Limits are 50 MB per file and 90 MB per batch. Each photo carries the flags `owner_visible`, `sub_vendor_visible` and `public_shareable`.
- **Weather on logs.** Today's weather comes from the national weather service's observations. Past dates come from a historical archive (`src/lib/domain/field/weather.ts`).
- **Reminders.** Missing-log reminders go to all staff, field staff or scheduled staff, at the company's time or each person's own time. There is at most one reminder per person per day, and none on non-working days or when the person's calendar shows time off.
- **Owner updates.** An update is `draft` and then `published`. A published update can be recalled. Drafts use approved photos only, and recall uses an optimistic revision check.

**Integrations.**

- The shared drive stores photo files.
- Weather providers (chapter 7).
- The legacy-system import (photo aliases, source dates).

**Tables.** `daily_logs`, `daily_log_photos`, `daily_log_photo_aliases`, `daily_log_task_links`, `daily_log_reminders`, `owner_project_updates`, `project_photo_source_dates`, `project_field_cost_codes`.

**Modules.**

- Libraries: `src/lib/domain/field/`, `src/lib/daily-logs/` and `src/lib/domain/media/`.
- Actions: `project-field.ts`, `project-photos.ts`, `daily-log-delete.ts`, `field-mode.ts` and `field-cost-codes.ts`.

## 2.5 To-dos, RFQs, POs and RFIs

**Purpose.** The operations domain keeps to-dos, purchase orders and RFQs in `project_operations`. It numbers them, sends them to vendors by tracked email, and queues write-direction rows for the accounting bridge. RFIs have their own tables.

**Key screens.**

- Per project: `projects/[id]/todos`, `/purchase-orders`, `/rfqs` and `/rfis`.
- Cross-project: `dashboard/purchase-orders` and `dashboard/rfis`.
- The vendor response dialogs: `components/projects/project-audience-*-dialog.tsx`.
- A no-login RFQ price page: `/quote/[token]`.

**Rules.**

- **Numbering** (`src/lib/domain/operations/rules.ts`, `src/lib/domain/rfis/rules.ts`):

  | Record | Number |
  |---|---|
  | To-do | `TASK-NNN` |
  | Purchase order | `<job>-PO-NNN` |
  | RFQ | `<job>-RFQ-NNN` |
  | RFI | `<job>-RFI-NNN` |

- **To-dos.** Statuses are `open`, `in_progress`, `blocked`, `complete` and `archived`. Aliases are normalized: cancelled becomes archived, and done or closed becomes complete. Record types are staff, subcontractor, supplier and schedule task. Events go to `project_todo_events`.
- **To-do list.** To-dos are the first list on the shared record table (section 4.7): sortable name, description, status, assignee, due date, author and priority columns, search, record details and 25/50/100 paging. A deep link to a record beyond page one reveals it.
  - **Bulk actions.** Staff select to-dos and confirm *archive*, *restore* or *delete* (`changeProjectTodos` → `changeProjectTodosCommand`, `src/lib/domain/operations/bulk-todos.ts`).
  - **Rules.** Archive takes only active to-dos; restore and permanent delete take only archived ones. Delete also needs the `tasks` delete permission, and the single-record delete dialog follows the same rule. Each selected row carries its `updated_at`; if any row changed or disappeared, nothing is written and the user is asked to refresh. The store write checks project, record type, status and version, and a restore writes its history and status change atomically. Ids are read in `chunkD1Values` chunks.
- **Purchase orders.** Statuses are `draft`, `approved`, `sent`, `ordered`, `partially_received`, `received`, `complete`, `closed` and `void`. A PO can be edited only while it is a Compass draft that has not been queued to accounting. The header total is the server-computed sum of its lines.
- **RFQs.** Statuses are `draft`, `sent`, `response_received`, `awarded`, `declined`, `complete`, `closed` and `void`.
  - Awarding needs the `rfqs` approve permission and locks the RFQ.
  - Editing is allowed only before a response arrives. Deleting is allowed only in draft.
- **RFIs.** Statuses are `new`, `in_progress`, `info_needed`, `complete` and `void`. Priority is low, normal or high. Audience is internal, vendor, owner or public. The first response stamps `answered_at`.
- **Accounting queue.** A row can be queued for the bridge only when it is write-direction and ready. Queue states are ready, queued and blocked.

**Integrations.**

- Tracked email (section 6.7).
- The vendor portal responses.
- Drive document links on RFQs.
- The accounting bridge queue.

**Tables.** `project_operations`, `project_purchase_order_lines`, `project_todo_events`, `project_rfis`, `project_rfi_attachments`, `project_rfq_email_deliveries`, `project_rfq_quote_links`, `project_rfq_manual_response_events`, `project_rfq_bid_approvals`.

**Modules.**

- Libraries: `src/lib/domain/operations/`, `src/lib/domain/rfis/`, `src/lib/rfqs/` and `src/lib/purchase-orders/`.
- Actions: `project-operations.ts`, `project-todos.ts`, `project-purchase-orders.ts`, `project-rfis.ts`, `project-rfq-*.ts` and `rfq-quote-link.ts`.

## 2.6 Financials and pay applications

**Purpose.**

- Keep accounts receivable and payable records: invoices, vendor bills, payments and credit memos.
- Build owner pay applications in G702/G703 form against the contract budget, with retainage, deposits and change orders.
- Approve pay applications for billing and tie them to an accounting invoice.
- Record payments received against billed pay applications and invoices, and void them with a reason.
- Feed billing from shop tickets and travel-zone charges.
- Reconcile card payments into accounting.

**Key screens.**

- `dashboard/financials`.
- `projects/[id]/financials` and its `pay-applications/[applicationId]` page.
- `projects/[id]/budget` and `projects/[id]/shop-tickets`.
- Components: `components/financials/` and `components/projects/pay-application-*`.

**Rules.**

- **Totals.** Totals are recomputed on the server from line items (`src/lib/domain/financials/rules.ts`):
  - invoice or bill total = subtotal + tax;
  - amount due = total − paid.

  Statuses:

  | Record | Statuses |
  |---|---|
  | Invoice | `draft`, `sent`, `partially_paid`, `paid`, `overdue`, `void` |
  | Bill | `pending`, `approved`, `partially_paid`, `paid`, `void` |
  | Credit memo | `draft`, `applied`, `void` |
- **Pay applications.** Rows live in `project_budget_applications` and `project_budget_lines`. Line math is in `src/lib/domain/budget/rules.ts`:
  - total = previous + current + stored;
  - percent complete is rounded to one decimal;
  - retainage is at most 100%.

  The status flow is `building` → `draft` → `internal_review` → `billed` (section 6.4).
  - Billing makes the application visible to the owner.
  - The accounting invoice number can be set only once the application is billed.
  - Undoing billing is blocked once a later application or an invoice number exists, or while payments are applied to the application.
- **Payments received against pay applications and invoices.** Staff record a customer's payment against a specific billed pay application or invoice, split one payment across several of the same customer's open items on the project, apply an unapplied remainder later, and void a payment with a reason. Section 6.10 has the flow.
  - **Where.** A "Payments received" panel on the pay application page (billed applications) and on project financials, with two lists on the shared record table: *Billed items* (item, billed date, amount, paid, outstanding, status *Open* / *Partially paid* / *Paid*, and **Record payment**) and *Payments* (reference, received, method, amount, applied to, unapplied, status *Applied* / *Partly applied* / *Unapplied* / *Void*, the accounting note, and the **Apply** and **Void** actions). The organization-wide invoices list adds a Paid column and a "Record payment" link. The owner's billing page shows *Paid* or *Partially paid* and "paid · outstanding" amounts once payments exist.
  - **What can take a payment.** Only Compass-billed pay applications (`source_system = 'compass_contract_budget'`, status `billed`) and invoices that are neither `draft` nor `void` (`payApplicationAcceptsPayments`, `invoiceAcceptsPayments`). Pay applications imported from the accounting system or the shared drive do not take payments.
  - **Methods.** `check`, `cash`, `ach` and `card` (`RECEIVED_PAYMENT_METHODS`, `src/lib/domain/financials/statuses.ts`). Card payments taken through the card-payment provider arrive through the bridge instead (section 6.6).
  - **Allocation rules.** `planPaymentAllocations` (`src/lib/domain/financials/rules.ts`) works in integer cents from the stored values. It refuses a non-positive amount, an item that is not one of this customer's open items, the same item twice, more than an item's open balance, more than the payment's unapplied amount, and a payment that mixes construction and preconstruction billing. A payment belongs to one project, so it can be split across that customer's items on that job but not across jobs.
  - **Balances.** A pay application's paid amount is not copied onto the application: it is the sum of its unreleased `pay_application_payment_allocations` rows, read on demand. Its billed amount is `current_payment_due`, which is already net of any applied deposit. An invoice keeps its stored `amount_paid`, `amount_due` and `status`, updated in the same batch (`invoicePaidValues`).
  - **Void rules.** A payment is never deleted once applied. Voiding needs a reason (required, at most 500 characters), stamps `voided_at`, `voided_by` and `void_reason` on the payment, and releases its allocation rows (`released_at`, `released_by`), which stay as history and stop counting toward balances. An invoice's paid amount drops only by what that payment applied, never below zero (`paidCentsAfterRelease`). A payment that is already void, or that came from the card-payment bridge, cannot be voided in Compass (`paymentVoidBlocker`); a bridge payment is refunded or reversed in the accounting system. The older payment edit and delete actions refuse to change the amount, project, customer or billing scope of an applied payment, and refuse to delete it ("void it instead"). Undo billing on a pay application is refused while payments are applied to it.
  - **Concurrency.** One D1 batch per payment holds the payment insert, every allocation and every invoice update. Each allocation insert repeats the action's read as a guard (the application is still billed, the item's paid amount and the payment's applied total are unchanged, the payment is not void). If a guard fails it writes 0 cents, which the positive-amount CHECK rejects, so the whole batch rolls back and the user is asked to refresh. A second void writes a blank reason, which the void-reason CHECK rejects, in the same way.
  - **Permissions.** Every action uses `projectContext(projectId, { scope: "organization", feature: "financials" })`: read needs `read`, record and apply need `create`, and void needs `update`. Mutations refuse the demo account. The owner balance read uses `scope: "member"`, the same rule as the owner budget page.
  - **Activity.** `payment_received`, `payment_applied` and `payment_voided`. No email or notification is sent.
  - **Accounting.** Compass does **not** post payments to the accounting system. Staff enter receipts there themselves, because the accounting system restricts automated payment posting. Each Compass-recorded payment shows "Enter in" the accounting system, or "Reverse … if entered" once void. Card payments are posted only by the existing card-payment bridge (section 6.6), and Compass shows them as posted by that bridge.
- **Contract budget revisions.** Revisions are numbered R1, R2 and so on, and exactly one is `current`. A rebuild is skipped when a source hash shows nothing changed.
- **Travel and zone charges.** There is a per-man-hour charge by straight-line distance zone from a configurable home base, a mountain charge by site elevation band, and lodging and per-diem flags (`src/lib/portfolio-map/travel-zones.ts`). Company settings live in `travel_charge_settings`; per-job overrides live in `project_travel_charge_overrides`.
- **Shop tickets.** Statuses are `draft`, `issued` and `void`. Labor and machine rates come from the rate book.
  - Issuing requires lines and a pay-application month, and re-checks cost codes against the budget.
  - Voiding requires a reason.
  - Labor hours can be looked up from accounting through the bridge.

**Integrations.**

- The accounting bridge: pay-application snapshots, labor hours and tax catalog (chapter 7).
- The card-payments adapter (section 6.6).
- A legacy ERP module whose sync columns remain on the AR and AP tables.

**Tables.** `invoices`, `vendor_bills`, `payments`, `credit_memos`, `invoice_payment_allocations`, `pay_application_payment_allocations`, `project_budget_applications`, `project_budget_lines`, `project_contract_budget_*`, `project_contract_deposits`, `travel_charge_settings`, `shop_tickets`, `shop_ticket_lines`, `rate_book_entries`, `sage_pay_application_*`, `sage_square_*`.

**Modules.**

- Libraries: `src/lib/domain/financials/`, `src/lib/domain/budget/`, `src/lib/financials/` and `src/lib/shop-tickets/`.
- Actions: `invoices.ts`, `vendor-bills.ts`, `payments.ts`, `received-payments.ts`, `credit-memos.ts`, `project-financial-workflows.ts`, `pay-application-billing.ts`, `sage-pay-applications.ts`, `shop-tickets.ts` and `travel-charges.ts`.

## 2.7 Documents and Drive

**Purpose.** The company's shared drive is the file store. Compass browses each project's folder, uploads to it and publishes from it. Compass keeps its own records of what owners and vendors may see, and writes PDF copies of records back to the drive.

**Key screens.**

- `dashboard/files`.
- `projects/[id]/documents`.
- The `DriveItemField` picker (`components/google/drive-item-field.tsx`).
- Print pages under `src/app/print/`.

**Rules.**

- **Who.** Only internal staff manage project documents and browse the drive (`src/app/actions/drive-picker.ts`).
- **Browse, never paste.** Every drive-link field uses `DriveItemField`. It can browse the drive, browse a Compass project or upload from the computer, and falls back to a pasted link. CI enforces this.
- **Categories.** Categories are a fixed list of plan types, specifications, addenda, approved sketches, geotechnical reports and other (`src/lib/project-documents.ts`).
- **Sharing.** Every document has two independent flags, `visible_to_owner` and `visible_to_sub_vendor`. Staff always see every document. Outside viewers are authorized by Compass records, not by drive permissions (`src/lib/google/project-document-drive.ts`).
- **Publishing.** A published file must be inside the project folder. It is unique per project and drive file. Its status is `current`, `superseded` or `archived`. A project's *working plan set* points at one current document.
- **Removal.** A document that backs an estimate or contract cannot be removed.
- **Paper trail.** Purchase orders, estimates, RFIs, change orders and shop tickets are copied to the drive as PDFs after a quiet period. The period is set per company: 1 to 60 minutes, 3 by default, with the whole feature off, pilot or on. Copies go to a private internal folder when the subfolder is shared outside the company, and are skipped when the project folder itself is shared outside. A hand-saved duplicate puts the record into `needs_choice` (`src/lib/paper-trail/`).
- **Print.** "Print Preview" is the standard view for every document. Snapshots last 7 days and are capped at 1.5 million characters. PDFs are rendered with the `BROWSER` binding.

**Integrations.** The Google Drive adapter (service account with domain-wide delegation; chapter 7) and Cloudflare Browser Rendering.

**Tables.** `google_auth`, `project_documents`, `project_record_drive_files`, `project_record_drive_snapshots`, `drive_folder_share_checks`, `print_snapshots`.

**Modules.**

- Domain: `src/lib/domain/documents/`.
- Libraries: `src/lib/google/`, `src/lib/paper-trail/` and `src/lib/print/`.
- Actions: `google-drive.ts`, `drive-picker.ts`, `project-documents.ts` and `paper-trail.ts`.

## 2.8 Messaging, email, meetings and calendars

**Purpose.**

- Internal chat: channels, threads and direct messages.
- A notification inbox that fans out to email, SMS and push.
- Tracked outside email, with replies synced back.
- Inbound SMS triage.
- Client video meetings with transcripts.
- Personal and project calendars.
- In-app video calls and a shared listening room.

**Key screens.**

- `dashboard/conversations`.
- Project mail: `projects/[id]/messages`.
- Triage queues: `dashboard/office-maintenance/{message-desk,inbound-email}`.
- Video and the listening room: `components/voice/`.
- The calendar card in Settings.

**Rules.**

- **Channels.** A channel is text, voice or announcement. Member roles are owner, moderator and member. Reading a channel requires membership (`src/lib/conversations/channel-access.ts`).
- **Notifications.** Each person sets in-app, email, SMS and push channels and per-topic switches (`notification_preferences`).
  - SMS needs recorded consent for the current phone number. Quiet hours fail closed (`src/lib/notifications/sms-policy.ts`).
  - Push goes through FCM or APNs (`src/lib/push/`).
  - **Links go to the exact record.** When a notification's source is a known RFI, RFQ, purchase order, to-do or schedule item, `notificationSourceHref` (`src/lib/notifications/source-href.ts`) turns its project or list link into a link to that record, with a status filter that keeps the record visible. The shared persistence path (`src/lib/notifications/create-event.ts`) supplies this link to the bell, email and push. Bell entries issued before the change are repaired from their stored source when read; events and recipients are not rewritten. Recipient-specific preview routes, conversations, outside replies, links to a different project, unknown types and sources without an exact id keep their own route.
- **Work Calendar.** The cross-project Work Calendar (`dashboard/schedule`) opens on *Events*. Explicit links to tasks, RFIs, purchase orders, schedules or *All* still select that source, and an older source link without a kind shows all kinds so its target is not hidden (`workCalendarFilter`, `src/lib/work-calendar-navigation.ts`). Filter changes are written to the URL, and date navigation keeps an explicit *All*. A project's own schedule keeps its separate Gantt entry point.
- **Tracked email.** `sendTrackedEmail` (`src/lib/email/tracked-send.ts`) is the only way to email an outside party about a record. See section 6.7 and section 4.6.
  - Sender: the staff member's own verified mailbox, a department mailbox, or the system sender (`src/lib/email/staff-sender.ts`).
  - Transport: Gmail first, with a transactional-email fallback (`src/lib/email/compass-email.ts`).
- **Inbound SMS.** Inbound texts are matched to a project or queued for review (`src/lib/goto/`). Missing message bodies are recovered every 10 minutes.
- **Message desk.** Statuses are `new`, `follow_up_needed`, `in_progress`, `waiting_on_contact` and `closed`. Aging thresholds are set per company. Stale reminders run every 10 minutes.
- **Client meetings.** Only staff schedule them. A 10-minute job waits 10 minutes after a call, then saves the transcript PDF to the project's meeting-notes folder and creates an internal draft daily log. It gives up after 24 hours (`src/lib/client-meetings/transcripts.ts`).
- **Personal calendar.** Each staff member gets an app-created calendar holding their schedule items, to-dos and milestones. It is off, pilot or on per company, and is refreshed at most every 5 minutes per person.
- **Project calendars.** Project calendars are staff-only. They are off for every job until staff create one on the Information page.
- **Video.** Video calls use Cloudflare RealtimeKit through a proxy route, for active internal staff only.
- **Listening room.** One Durable Object per room (`ListeningRoomCoordinator`) relays WebSocket messages with a sequence number. Anyone in the room controls playback and sets their own volume.

**Integrations.** Gmail, a transactional-email provider, the SMS provider, the meetings API, the calendar API, FCM and APNs, RealtimeKit, and Durable Objects.

**Tables.** `channels`, `messages` (plus attachments, reactions, mentions, members and read state), `notification_*`, `email_reply_threads`, `inbound_emails`, `email_mailbox_state`, `project_correspondence*`, `correspondence_*`, `staff_message_*`, `goto_inbound_*`, `project_client_meetings`, `my_compass_calendars*`, `compass_project_calendars*`, `google_calendar_*`, `work_calendar_*`, `voice_*`, `listening_*`, `push_tokens`.

**Modules.**

- Domain modules: `src/lib/domain/{conversations,correspondence,notifications,calendars,work-calendar,listening}/`.
- Libraries: `src/lib/email/` and `src/lib/goto/`.

## 2.9 Contacts directory

**Purpose.** One directory holds:

- customers (companies and people);
- vendors (companies and contacts);
- internal staff.

It is linked to project contacts, to Compass accounts, and to the accounting system's client and contact records through a reviewed bridge queue.

**Key screens.** `dashboard/contacts` has customers, vendors and internal tabs; the older routes redirect there. Project contacts are at `projects/[id]/contacts`.

**Rules.**

- **Project contact types.** Types are owner, supplier, subcontractor and internal. A placeholder name waits as `pending_assignment`.
- **Feature permissions.** The features are customers, vendors, internal-directory, project-contacts, employee-contact-private and accounting-contact-review.
  - The internal directory is hidden from outside and demo organizations.
  - Private employee details need an explicit per-person grant.
- **Merging duplicates.** A merge needs delete permission, previews blockers, and is blocked while accounting proposals are active.
- **Account links.** Only admins link directory people to accounts. Roles must pair: a client with a customer person, and a subcontractor or supplier with a vendor person.
- **Self-service.** People edit their own record, and the change goes through accounting review.
- **References.** Records that held only a typed copy of a party now also link to the directory (migration 0280): `projects.client_customer_id` → `customers`, `project_operations.vendor_id` and `project_budget_lines.vendor_id` → `vendors`, and `project_rfis.assigned_project_contact_id` → `project_contacts`. Reads prefer the link. The copied text stays as a fallback, and for a sent RFQ or PO as the snapshot of what was sent. Validation triggers keep each link inside the record's own company. `scripts/relational-links-backfill.mjs` fills links by exact match only (`src/lib/domain/contacts/directory-links.ts`, `relational-links-plan.ts`).

**Tables.** `customers`, `customer_contacts`, `vendors`, `vendor_contacts`, `internal_contacts`, `internal_contact_private_addresses`, `project_contacts`, `project_contact_source_links`, `contact_merge_events`, `contact_account_link_events`, `sage_contact_*`, `sage_client_directory_*`.

**Modules.**

- Domain: `src/lib/domain/contacts/` (store, rules, access, link-matching, review).
- Actions: `customers.ts`, `vendors.ts`, `project-contacts.ts`, `contact-duplicates.ts`, `contact-account-links.ts` and `sage-contact-*.ts`.

## 2.10 Product sales / online ordering module

**Purpose.** This optional module covers catalog product sales and equipment rentals for one department. It reuses the shared estimate, purchase-order, drive and email systems instead of duplicating them.

**Key screens.**

- `dashboard/{sales}` holds the department queue and rental inventory.
- `dashboard/{sales}/catalog`.
- `projects/[id]/{sales}` holds the order workspace and rentals.
- An order-form file route sits under `api/projects/[id]/`.

**Rules** (`src/lib/{sales}/workflow.ts`):

- **Order statuses.** `intake` → `quantities_ready` → `estimate_ready` → `customer_approved` → `po_ready` → `po_released` → `vendor_confirmed` → `invoice_received` → `invoice_released` → `complete`, or `cancelled`. Each order status maps to a job status, so the sales pipeline follows automatically. Cancelling an order leaves the job status unchanged.
- **Releasing the manufacturer PO.** All of these must be in place:
  - the customer type, pricing and quantity source are set;
  - a signed takeoff acknowledgement exists when staff did the takeoff;
  - a linked Compass PO with items exists;
  - a freshly generated manufacturer workbook exists;
  - the customer's payment and requested date are recorded;
  - trailer details are recorded for a pickup.

  A released PO cannot move back.
- **Catalog.** Catalog versions start as `draft` and must be activated. Each order keeps the catalog version it started with. Product-to-cost-code mapping is set deliberately, never guessed.
- **Rentals.** Rentals are `reserved`, `out` or `returned`.
- **Access.** The feature permission is the module's orders feature: read and update for the work, approve for catalog changes.
- **Pricing.** Card payments are charged at the regular price. A cash or check discount is a pricing option.

**Note.** Public customer self-ordering is a planned extension. The current public `/quote/[token]` page is the vendor RFQ price page, not customer ordering.

**Tables.** `{sales}_catalog_versions`, `{sales}_products`, `{sales}_catalog_prices`, `{sales}_order_workflows`, `{sales}_order_items`, `{sales}_bracing_rentals`, `{sales}_bracing_rental_lines`.

**Modules.** `src/lib/{sales}/`, `src/lib/domain/{sales}/` and actions `{sales}-*.ts`.

## 2.11 Company values board, dashboard and maps

**Company values board (name configurable).**

- Staff post weekly recognitions (shout-outs and wins) or concerns, each tagged with a company value.
- A reviewer approves posts into the team stream, where people react and reply.
- Submissions always start in `needs_review`. Concerns are never shown to field crews.
- A greeting-card workflow sends mailed cards or e-cards with approval: `pending_approval` → `approved` → `submitting` → `submitted`, or `needs_attention`. Mailed cards and gift cards go through optional adapters.

Routes are `dashboard/{values}` and `dashboard/cards`, plus the public `/ecard/[token]`. The tables are `{values}_pulse_responses`, `{values}_pulse_story_states`, `{values}_pulse_story_replies`, `{values}_card_fulfillments` and `greeting_card_requests`. The value names are not yet a company setting; see chapter 12.

**Dashboard.** `/dashboard` renders `components/dashboard/dashboard-launchpad.tsx`. It shows:

- the values board strip and headline counts (active projects, upcoming tasks, photos to review, open RFIs, open PO amount, draft owner updates);
- the portfolio map and pipelines directly beneath;
- newer features below those (a UI standard enforced by a test).

Project priority score = open RFIs × 5 + photos to review × 3 + open POs × 2 + (1 if a next task exists). Custom dashboards are generated by the assistant (`custom_dashboards`).

**Portfolio map, weather and fire.**

- **Map.** A 3D terrain map of jobs with a 2D pipeline fallback (`components/dashboard/portfolio-map/`, `src/lib/portfolio-map/`). The map state is a company setting and can be any US state. Markers show late or at-risk work.
- **Notifications on the map and pipelines.** Map notification tiles open the exact source record (the same `notificationSourceHref` links as the bell), and each tile keeps its notification's identity after the tiles are sorted by kind. Project markers still select the job's details. Pipeline cards show an unread indicator: one source opens directly, several open the job's source list. The project, sales and internal-workspace views, and the 2D pipeline fallback, behave the same way. The dashboard reuses the bell's recipient-scoped inbox and groups unread sources once rather than querying each job. Navigation happens before the optimistic mark-read, and modified clicks (for example opening in a new tab) keep normal browser behavior. Owner and vendor map views keep project selection only.
- **Weather.** Every 10 minutes a job refreshes weather warnings, active wildfires and perimeters, and site forecasts that someone has viewed recently (chapter 7).
- **Default limits.** Snow 4 in, rain 0.5 in, gusts 30 mph, cold 0 °F, heat 95 °F, fire within 25 miles. Work rules flag pours below 40 °F, lifts in gusts over 30 mph and exterior work in heavy rain. Both are company settings.

Tables: `weather_points`, `weather_cells`, `weather_area_snapshots`, `weather_zone_shapes`, `weather_schedule_risks`.

**Today's plan.** Each person's plan sorts schedule items, to-dos and meetings into overdue, today and this week. An overload check compares assigned workdays with available ones, at 100% by default. An optional digest goes out at the person's hour (`src/lib/morning-plan/`).

## 2.12 Settings and permissions

**Purpose.** Company configuration, a role-based permission matrix with feature-level overrides, department identity and per-user appearance.

**Key screens.** `dashboard/settings` has these tabs: preferences, appearance, company, workflows, permissions, integrations, agent, rate book and zone charges.

**Rules.**

- **Roles.** Roles and the permission matrix are in `src/lib/user-roles.ts` and `src/lib/permissions.ts`; see chapter 8.
- **Feature settings.** There are 33 feature-settings groups (`FEATURE_SETTINGS` in `src/lib/feature-settings/registry.ts`). Each group has a zod schema and defaults, is validated on save and can be reset. Admins and secondary admins edit them; some groups are admin-only. Values are stored as one JSON row per company and group (`organization_feature_settings`).
- **Department profiles.** A department profile holds the display, legal and sender identity used on documents, emails and portals.
- **Themes.** Themes include presets plus per-user custom themes, including themes generated by the assistant (`src/lib/theme/`).

**Tables.** `organization_feature_settings`, `role_permission_overrides`, `team_permission_overrides`, `user_permission_overrides`, `permission_audit_events`, `organizations`, `organization_members`, `teams`, `team_members`, `groups`, `custom_themes`, `user_theme_preference`.

## 2.13 AI assistant and agent tools

**Purpose.** An in-app assistant runs an agent loop with tools that call Compass APIs. Destructive actions wait for the user's confirmation. Optionally, an external agent runtime can be connected through a signed bridge that also feeds a feedback desk.

**Runtime.**

- `src/app/api/agent/route.ts` uses `packages/agent-core` (`runAgent`, an MCP server for Compass tools, a client manager).
- The provider is chosen per company, with fallbacks across providers (`src/lib/agent/runtime-config.ts`). Provider keys are encrypted at rest.
- Help content is injected as context (`src/lib/help/assistant-context.ts`).

**Tools** (`packages/agent-core/src/tools/`):

- data query;
- message search;
- schedule reads and writes;
- dashboards;
- memory;
- feedback;
- navigation and notifications;
- generated UI;
- skills;
- themes;
- issue tracker.

The tools call the `/api/compass/*` routes with an agent key.

**Rules.**

- Schedule writes, dashboard deletes and filing feedback need confirmation. Each confirmation is a 10-minute signed token (`src/lib/agent/pending-actions.ts`).
- Using the assistant needs `agent` read and a role that is not guest.
- MCP keys are stored hashed with scopes (`src/lib/mcp/auth.ts`).
- The external bridge uses signed requests. Its feedback-desk statuses are `new`, `triaged`, `needs_info`, `planned`, `in_progress`, `testing`, `deployed` and `closed`.

**Tables.** `agent_config`, `agent_usage`, `user_model_preference`, `user_provider_config`, `agent_conversations`, `agent_memories`, `agent_items`, `agent_action_confirmations`, `mcp_api_keys`, `mcp_usage`, `mcp_servers`, `plugins*`, `feedback*`, `jarvis_bridge_events`.

## 2.14 Mobile and desktop shells

**Mobile (Capacitor).** `capacitor.config.ts` supports two modes:

- **Bundled field shell** (the default). `webDir: mobile-shell`, built from `mobile-shell-src/` by `scripts/build-mobile-shell.mjs`. It has:
  - PKCE sign-in and an optional biometric lock;
  - an offline outbox in device preferences (`compass_field_outbox_v1`) for daily logs, machine logs, chat messages and values-board posts, with attachments kept on the device filesystem;
  - server APIs under `src/app/api/field/*` and `api/mobile/health`.
- **Live wrapper** (`COMPASS_MOBILE_MODE=live`). This mode loads the hosted app.

Navigation is limited to the app and sign-in hosts. Every Capacitor import is dynamic and gated behind `isNative()`, so native code can never break the web app (`src/lib/native/platform.ts`).

**Desktop (Electron).** `electron/main.ts` loads the hosted app with context isolation on and node integration off. The preload script exposes `window.compassDesktop` for window state, zoom, global shortcuts, open-external and auto-update (electron-updater). The legacy offline-sync API (`/api/sync/*`) was retired and returns a refusal; the desktop queue code remains but has no server path (chapter 12).

## 2.15 Help

**Purpose.** Searchable in-app guides, filtered by audience and permission, with tutorial videos.

- **Source.** Guides are written in `docs/help/guides/*.md`. `scripts/generate-help-resources.mjs` compiles them into `src/lib/help/help-guides.generated.ts`.
- **Freshness.** `bun run help:check` (run in CI) fails when a guide is overdue for review (180 days).
- **Who sees what.** The audience follows the role: client → owner; subcontractor and supplier → their own audiences; everyone else → staff. A guide shows only when its audience matches and the user holds its required permissions (`src/lib/help/index.ts`).
- **Videos.** Videos stream from the private `HELP_VIDEOS` R2 bucket with range support. Unknown and forbidden videos both return 404, so ids cannot be probed (`src/app/api/help/videos/[videoId]/route.ts`). Re-recording steps are in `docs/development/help-videos.md`.
