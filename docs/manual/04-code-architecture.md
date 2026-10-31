# 4. Code architecture and standards

The rules in this chapter come from `docs/development/architecture-standards.md`, `conventions.md`, `ui-standards.md` and `email-workflows.md` under `docs/development/`. If this chapter and those files ever disagree, those files win. Most rules are enforced by tests that run in CI; the rest are checked in review.

![Code layers](diagrams/code-layers.png)

## 4.1 Domain modules

Every kind of record belongs to exactly one domain module under `src/lib/domain/<module>/`. A module is made of three files:

| File | Owns | Must not |
|---|---|---|
| `access.ts` | Who may see or change the record, built on the action context | Write tables |
| `rules.ts` | Pure business logic: numbering, status transitions, totals, validation, allowed-action flags | Touch the database or network |
| `store.ts` | Every insert, update and delete for the module's tables, usually as one `db.batch` that includes audit and activity rows | Contain UI or request parsing |

Large modules split `store.ts` by sub-concern while keeping a single owner per table. For example, `estimates/` has `acceptance.ts`, `drafts.ts`, `lines.ts` and `signature.ts`, and `field/` has `daily-logs.ts` and `owner-update-*.ts`. There are 33 modules, including `project`, `families`, `estimates`, `operations`, `rfis`, `schedule`, `field`, `documents`, `contacts`, `crm`, `correspondence`, `conversations`, `notifications`, `calendars`, `work-calendar`, `financials`, `budget`, `selections`, `warranty`, `templates`, `trade-letters`, `sage-bridge`, `buildertrend`, `identity`, `settings`, `media`, `weather` and `{sales}`.

Server actions (`src/app/actions/`) and API routes (`src/app/api/`) are thin adapters. They do four things:

1. parse the input;
2. call the domain module;
3. revalidate paths;
4. return the result.

Integrations (accounting, workspace, legacy import, e-sign, payments) call domain stores. They never write tables directly.

## 4.2 One writer per table

Only the owning module's `store.ts` may write a table, whether through Drizzle or raw SQL. `scripts/architecture-metrics.mjs` finds every writer file for every table:

- **Drizzle writes:** `.insert(t)`, `.update(t)` and `.delete(t)`.
- **Raw SQL writes:** upper-case `INSERT INTO`, `UPDATE` and `DELETE FROM`, followed by a real table name.

Appendix A lists each table's writers. A new writer outside the frozen list fails CI. Three more layering rules apply:

- `src/lib` never imports from `src/app`. Move shared logic down into `src/lib`.
- A server action never imports another server action file for its logic. Both call the domain module instead.
- A `page.tsx` is a server component.

## 4.3 Shared helpers

Use these modules; never define a local copy. The metrics script flags local definitions of `formatDate`, `formatMoney`, `formatCents`, `isRecord`, `cleanText`, `envString`, `safeFileName`, `escapeHtml` and similar helpers anywhere outside their home files.

| Job | Use |
|---|---|
| Money | `src/lib/format.ts` (`formatCents`, `formatDollars`). Amounts are stored and passed as integer cents |
| Dates | `src/lib/format.ts` (`parseDateOnly`, `formatDateOnly`). A date-only value never goes through `new Date("YYYY-MM-DD")` |
| Type guards | `src/lib/shared/guards.ts` (`isRecord`, text and number readers) |
| Text | `src/lib/shared/text.ts` |
| Environment | `src/lib/shared/env.ts` (`envString`, `envFlag`); never `env as unknown as Record<string, string>` |
| D1 parameter limits | `src/lib/d1-query.ts` (`chunkD1Values`, `chunkD1Rows`, `chunkD1InsertRows`); never a hand-written slice loop |
| Action results | `ActionResult<T>` and `actionFailure` (`src/lib/action-result.ts`) |
| Database handle type | `Db` (`src/lib/server/action-context.ts`) |
| Class names | `cn()` (`src/lib/utils.ts`) |

## 4.4 The action context

`src/lib/server/action-context.ts` is the one place a server action or API route finds out who is asking, for which organization, and whether they are allowed:

| Function | Use when | Returns |
|---|---|---|
| `userContext(options)` | Personal actions that work without an active organization | `{ user, organizationId \| null, db, env }` |
| `requireUserContext(options)` | Older call sites that throw on failure | the same, or throws |
| `orgContext(options)` | Company-scoped actions | `{ user, organizationId, db, env }` |
| `projectContext(projectId, { scope, ... })` | Actions about one project | the above plus `project` |

Options:

- `feature` names the feature permission to check.
- `action` is the action to check it for. It defaults to `read`, or to `update` for mutations.
- `mutation: true` refuses the demo user and the demo company.
- `scope` is required for `projectContext`:
  - `organization`: the project belongs to the active company;
  - `member`: `getProjectAccessRecord`, which also admits project members such as invited owners and vendors.

Failures come back as an `ActionFailure` that the action can return unchanged. The messages are `Unauthorized`, `No active organization`, `DEMO_READ_ONLY`, `Permission denied: …` and `Project not found`.

**Do not** hand-roll `getCloudflareContext()` + `getDb()` + `getCurrentUser()` + role checks in an action, and do not write another local `verifyProjectAccess`.

## 4.5 CI ratchets

A *ratchet* freezes today's violations in a baseline and fails when:

- a new file or table breaks a rule;
- a baselined count grows;
- a baselined count shrinks without the baseline being updated. This locks in the improvement.

After you reduce a violation, regenerate the baseline with `bun scripts/architecture-baseline.mjs --write`. Review the diff: it should only remove entries or lower counts. Never edit a baseline upward to make a check pass. Every allowlist entry needs a written reason next to it.

| Check | File | What it measures |
|---|---|---|
| `tableWriters` | `src/lib/__tests__/architecture-standard.test.ts` (metrics in `scripts/architecture-metrics.mjs`, baseline in `architecture-baseline.json`) | The set of files that write each table (Drizzle and raw SQL); no new writer may appear |
| `largeFiles` | same | Files over 800 lines in `src/app`, `src/lib` and `src/components`; may not grow, and no new file may exceed 800 |
| `localHelpers` | same | Local definitions of shared helper names outside their home files |
| `envCasts` | same | `as unknown as Record<string, string>` environment casts |
| `libImportsApp` | same | `src/lib` files importing `@/app/...` |
| `actionImportsActions` | same | Action files importing other action files |
| `clientPages` | same | `page.tsx` files that start with `"use client"` |
| `handRolledContext` | same | `getCloudflareContext()` calls in actions and API routes |
| `typeAssertions`, `nonNullAssertions`, `explicitAny` | same | Counted from the TypeScript AST, per file: `x as T` (not `as const`), `x!` and `any` |
| `statusColumnsWithoutList` | same | Per schema file, enumerated status, state, kind, type or role columns that are neither typed from a shared list nor exempt (section 4.8, "Status lists") |
| Schema integrity | `src/db/__tests__/schema-integrity-standard.test.ts` | Every schema file is listed in `drizzle.config.ts`; replaying all migrations matches the Drizzle schema (tables, columns, indexes, both ways; frozen differences in `SCHEMA_DIFFERENCE_BASELINE`); every foreign-key column leads an index; every internal `*_id` / `*_by` column has a foreign key, a validation trigger, or a written exemption, as classified in `src/db/id-integrity.ts` (the needs-review list may only shrink, and every triggered column has its insert and update triggers and an index) |
| Polling | `src/components/__tests__/polling-standard.test.ts` | No raw `setInterval` outside a reasoned allowlist; no client-side refetch of data that a provider already holds (`getProjects`, `getNotificationCenter`) |
| Email workflow | `src/lib/email/__tests__/email-workflow-standard.test.ts` | Outside email goes through `sendTrackedEmail`; direct `sendCompassEmail` callers are an explicit list with reasons |
| Drive browse | `src/lib/google/__tests__/drive-browse-standard.test.ts` | No paste-only drive-link fields |
| Dashboard order | `src/components/dashboard/__tests__/dashboard-priority.test.ts` | The values board strip, the counts and then the map and pipelines stay at the top of the staff dashboard |
| UI standards | `scripts/check-ui-standards.mjs` (`bun run ui:check`) | Visible scrollbars, shared pagination, dialog and scroll primitives, no literal hex colors in components, and the standards document's required sections |
| Dead code | `knip` (`bun run knip`) | Unused files and exports |
| Help freshness | `bun run help:check` | Generated help is current, and guides were reviewed within 180 days |

Section 12.1 has the current counts.

## 4.6 Email workflow standard

Every workflow that emails people outside the company, or that reacts to something they do, follows `docs/development/email-workflows.md`:

- **Send** with `sendTrackedEmail`, under a record kind registered in `TRACKED_RECORD_KINDS` (`src/lib/email/tracked-record-email.ts`) with its label, notification event type and link.
  - Put the sender, or the department mailbox, in `alsoReplyTo`.
  - Send from Compass; never hand the user a `mailto:` link.
  - The sender is resolved on the server from the staff member's verified identity, so a person cannot send as somebody else's mailbox.
  - A rejected personal or department sender is reported. It is never silently swapped for the shared sender.
- **Replies** are routed by token. `announceTrackedRecordReply` writes Activity and notifies the sender and project staff. Replies appear on the record (`RecordEmailReplies`) and stay internal until staff act on them. A reply from the client counts as client contact for follow-up aging.
- **Notifications.**
  - Event types are prefixed with the settings switch they belong to (`rfi.`, `po.`, `owner_update.`, `schedule.`).
  - Never notify a person about their own action.
  - Use `notifyProjectStaffOfOutsideEvent` for webhooks and replies, and notify only on a real state change.
- **Activity.** Record an Activity event (`recordActivityEvent`) for every send, every reply and every outside status change. A failure to log Activity never fails the action.
- **Compose dialog.**
  - To and Cc use `EmailRecipientPicker`, filled from the project's contacts. Never use a free-text address field.
  - The subject is prefilled and editable. The record's content is always included.
  - The dialog says where replies will go.
  - Send stays disabled until there is a recipient.
  - Update the help guide in the same PR.

`sendCompassEmail` is still correct for mail that expects no reply: notification emails, invitations, greeting cards and the project email composer. Those callers are listed in the standard test.

## 4.7 UI standards

The canonical document is `docs/development/ui-standards.md`. Its main rules:

- **Built for any company.** No company names, addresses, rates, logos or wording in the code, except as a setting's default. New rules, thresholds and templates are settings with an editor. Field Mode (phone and tablet) is a separate audience and must stay simple.
- **Record lists** (approved standard). Every collection of records that grows uses one shared table layout:
  - columns that fit the record: reference, short description, status, responsible people, the dates that matter, author, and money where it applies;
  - every data column sorts, with dates and amounts sorted by their typed value;
  - a search box that resets the list to page 1;
  - the record name links to its detail view; record workflows (approve, send, sign, post) stay on the detail view or in the row's actions;
  - a checkbox column only where a bulk action exists;
  - only the actions the viewer may take; destructive actions need confirmation and recovery where possible, and financial or legally significant records (payments, posted pay requests, signed contracts) are never freely deletable from a list;
  - `DataTablePagination` with 25, 50 or 100 per page (default 25);
  - horizontal scrolling inside the table on mobile;
  - theme tokens only;
  - bulk actions call the owning domain store.

  Lists whose order carries meaning (line items, ranked queues, hand-arranged lists) keep that order on purpose.
- **The shared `RecordTable` component** (`src/components/record-table.tsx`) implements the standard on TanStack Table.
  - `useRecordTable({ data, columns, getRowId, resetKey, enableSelection, initialItemId })` owns sorting, row selection and pagination (default `DEFAULT_TABLE_PAGE_SIZE`). A data refresh keeps the current page and clamps it after a removal; a change of `resetKey` (a new search, filter or view) returns to page 1 and clears the selection; `initialItemId` moves to the page that holds a deep-linked record.
  - `recordSelectionColumn(getLabel)` adds the checkbox column with an accessible label per row, used only where a bulk action exists.
  - `RecordTable` renders the table with `TanstackSortableHeader` headers and `DataTablePagination`.
  - Project to-dos were the first list to move (section 2.5), with bulk archive, restore and delete through the operations store. The payments-received panel (section 2.6) uses it too. Other lists move in their own pull requests.
- **Tables and paging.**
  - Keep the current page across edits.
  - Reset to page 1 when the search or filter changes.
  - When a mutation removes the current page, clamp to the last valid page.
  - Sortable headers come from `TanstackSortableHeader`, or from `useTableSort` with `SortableTh` (`src/components/ui/sortable-header.tsx`).
- **Visual language.**
  - shadcn/ui New York style.
  - Semantic theme tokens from `src/app/globals.css`; no literal or stock-palette colors.
  - The "20% bubble rule": information surfaces are mostly flat, and `rounded-full` is used only for intrinsically round controls.
  - Prefer whitespace and dividers to nested cards.
- **Page anatomy.**
  - One `PageHeader` per page: the title names the page, with no explanation line underneath, and the actions sit on the right.
  - Forms have a readable maximum width.
  - In a list, the whole row is the click target.
- **Dashboard order.** The values board strip, the counts strip, then the map and pipelines. New features go below them.
- **Drive files.** Use `DriveItemField` or `DriveBrowseDialog`, which offer three sources: the drive, Compass projects and this computer. Never use a paste-only field.
- **Mutations.**
  - Use server actions with explicit results and revalidation.
  - Every create or edit has a permission-appropriate delete or void, with confirmation, authorization, dependency handling and audit or recovery.
- **Release review.** For visible UI changes, check the page-size control, mobile layout, page preservation, filtering, empty, loading and error states, accessibility labels, light and dark themes, and phone width.

## 4.8 TypeScript conventions

From `docs/development/conventions.md`:

- no `any` (use `unknown` and narrow);
- no `as` (fix the types, or use a guard);
- no `!`;
- discriminated unions instead of optional properties;
- `readonly` wherever mutation isn't intended;
- no `enum` (use `as const` arrays and unions);
- explicit return types on exported functions;
- result types instead of exceptions;
- a module scope with no side effects;
- zod v4 (`zod/v4`) for input schemas;
- import aliases `@/components`, `@/lib`, `@/hooks`.

Every status, type, kind or role column draws its values from an exported `as const` list (Appendix D.2), written in lower case with one spelling per concept (`canceled`, `completed`).

### Status lists

- **One list per concept, in its domain.** Each domain module keeps its enumerated values in `src/lib/domain/<module>/statuses.ts`: pure constants with no imports, so the schema files can import them too. At this edition there are such files for contacts, correspondence, documents, duties, estimates, feedback, field, financials, identity, operations, project, the accounting bridge, schedule, selections, settings, trade letters, warranty, the work calendar and the product sales module. Components, rules and stores import the same arrays instead of repeating values. Older modules keep `export type { X }` re-exports so existing type imports still work.
- **Typed columns.** A listed column is declared `text("status", { enum: LIST })`. On SQLite, Drizzle's `enum` adds no CHECK constraint, so typing a column needs no migration and the replayed schema is unchanged.
- **Stored lists and workflow lists.** Where live data holds values that the current workflow never produces, the module exports two lists. The *workflow* list is what screens offer, transitions allow and type guards accept (for example `ESTIMATE_STATUSES`, `USER_ROLES`, `SCHEDULE_LINK_TYPES`). The *stored* list is the workflow list plus the legacy values that may sit in existing rows (`STORED_ESTIMATE_STATUSES` adds `sent`, `STORED_USER_ROLES` adds `integration`, `STORED_SCHEDULE_LINK_TYPES` adds the legacy import link types). The store checks writes against the stored list, so a legacy row can still be rewritten, while pickers, assignment and status checks keep using the workflow list.
- **Store checks.** `src/lib/shared/statuses.ts` provides `isListValue`, `listValueOr`, `requireListValue`, `assertListFields` and `checkedListFields`. A module exports a column-to-list map (for example `CHANGE_ORDER_LISTS = { status: CHANGE_ORDER_STATUSES, changeOrderKind: CHANGE_ORDER_KINDS }`), and its store checks every insert and update with it, throwing `Unknown <table>.<column> value: "x"` before anything is written. Missing values, nulls and raw `sql` template expressions pass through, so partial patches are unaffected. Readers that defend against unknown stored values keep doing so.
- **Exemptions.** Values a company configures are data, not lists: custom project-contact roles, finish-selection room types, interaction types and trade-document types (custom job statuses already live in `project_job_statuses`). Postal regions and MIME-type columns are free-form. Each is listed with its reason in `STATUS_COLUMN_EXEMPTIONS` in `scripts/architecture-metrics.mjs`.
- **The `statusColumnsWithoutList` ratchet** counts, per schema file, the enumerated columns (a name ending in status, state, kind, type or role, or any inline `enum: [...]`) that are neither on a shared list nor exempt. Its baseline was 216 when it was introduced, and it may only shrink. Most of the remainder are legacy-import staging, accounting-bridge, legacy ERP, product-sales workflow, participant and template columns, plus `project_operations.status` (one column shared by to-dos, POs and RFQs, with values per type) and `projects.status` (upper-case registry values). Each needs its writers traced before it can be typed safely.
- **Values report.** `bun scripts/status-values-report.mjs --local|--remote` reads each listed column with one single-table `SELECT DISTINCT` (eight statements per call, read only). It writes `report.json`, a `normalise.sql` proposal for exact case, whitespace or separator variants and known spellings (`canceled`/`cancelled`, `complete`/`completed`, `archive`/`archived`), which is never applied automatically, and `review.json` for unknown values. Run it before typing a column that live data might contradict.

## 4.9 How to add a feature correctly

Use this checklist in every feature pull request. It follows the order of the work.

1. **Find the concept's home.** Search Appendix A and `docs/development/data-model-consolidation.md` before adding a table. Extend an existing concept (calendars, reply threads, saved views, event history, external links) instead of creating a parallel store.
2. **Choose the owning domain module.** Every new table gets exactly one owner, `src/lib/domain/<module>/store.ts`. Create a module only for a genuinely new kind of record.
3. **Design the schema in `src/db/schema*.ts`.** The schema needs:
   - text ids and ISO dates;
   - money in integer cents;
   - `organization_id`, or a project foreign key, for scoping;
   - `.references()` on every internal id, and an index led by every foreign key;
   - a unique index on link pairs and on `(source_system, source_*_id)` for imported rows;
   - `enum:` lists from an exported `as const` array;
   - child tables, never JSON arrays of ids;
   - snapshots named `*_snapshot`, or marked with a `// snapshot:` comment;
   - a one-line purpose comment above the table.

   Register any new schema file in `drizzle.config.ts`.
4. **Write an additive migration** `drizzle/NNNN_*.sql` that matches the schema exactly. No drops, rebuilds or column rewrites. Data changes go in a separate, approved PR.
5. **Write the pure rules in `rules.ts`**: numbering, transitions, totals, validation and the allowed-action flags the UI will show. Unit-test them.
6. **Write the store functions** in `store.ts`. Batch related writes with `db.batch`, including audit and Activity rows. Use no queries inside loops; chunk with the `d1-query` helpers.
7. **Write the access check** in `access.ts`, built on the action context. Register a feature permission in `PERMISSION_FEATURES` with sensible role defaults if the feature needs one.
8. **Make it configurable.** Add a group to `FEATURE_SETTINGS` (`src/lib/feature-settings/registry.ts`) with a zod schema, defaults and a Settings editor for every rule, threshold, label or template. Hard-code nothing that is specific to one company.
9. **Write the server action.** Start from `orgContext` or `projectContext` with `feature` and `mutation`. Parse with zod, call the domain module, revalidate, and return `ActionResult`. Never import another action file.
10. **Build the page.** `page.tsx` is a server component that loads the data, and client components receive props. Follow the UI standards:
    - one `PageHeader`;
    - lists built on the shared record-list table (sorting, search, 25/50/100 paging, bulk actions through the store, guarded deletes);
    - theme tokens only;
    - `DriveItemField` for drive links.
11. **Add the delete.** Provide a permission-appropriate delete or void with confirmation, dependency handling and audit. Financial records follow their own void or reversal rules.
12. **Handle outside parties.** If the feature emails or notifies them, use `sendTrackedEmail`, register the record kind, use `EmailRecipientPicker`, notify staff, log Activity and show the replies on the record.
13. **Handle audiences.** If owners or vendors can see the data, add explicit visibility flags and filter reads by audience on the server. Check the result in staff preview mode.
14. **Background work.** Add a scheduled job only if needed. It must be a signed `/api/operations/*` route that is idempotent, works within a time budget, keeps a cursor, and is added to `custom-worker.ts` and the public-path allowlist.
15. **Polling.** Any live data uses `useVisibleInterval`, through a shared provider.
16. **Tests.** Write unit tests for the rules, store tests against the SQLite test harness (`src/lib/domain/__tests__/sqlite-d1.ts`), and an E2E journey if the feature adds a page.
17. **Help.** Update or add a guide in `docs/help/guides/` and run `bun run help:generate`.
18. **Run the checks.** `bun run lint`, `bun run test`, `bun run ui:check`, `bun run knip` and `bun run build`. If a ratchet count went down, regenerate the baseline and commit it.
19. **Before deploying.** Apply the migration from the merged `main` (section 9.2), then deploy.
