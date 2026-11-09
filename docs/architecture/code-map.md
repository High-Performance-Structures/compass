Code Map
===

Start here. This page tells you where each part of Compass lives in the
repository, so you can find the code behind a screen, a table or a workflow and
change it by hand. It is a map, not a manual: each section links to the deeper
document when one exists.

If you only remember one thing: **a feature is spread across six places**, and
they always have the same names.

| Layer | Folder | What lives there |
|-------|--------|------------------|
| Database tables | `src/db/schema*.ts` | One Drizzle table definition per database table. The source of truth for the database's shape. |
| Migrations | `drizzle/NNNN_name.sql` | The SQL that changes the real database, one numbered file per change. |
| Domain module | `src/lib/domain/<area>/` | The business logic for one area: `store.ts` (the only code that writes its tables), `rules.ts` (pure calculations and checks), `access.ts` (who may see or change a record), `statuses.ts` (the allowed status values). |
| Other shared logic | `src/lib/<area>/` | Helpers, integrations (Sage, Google, Square) and logic that is not a table owner. |
| Server actions | `src/app/actions/<area>.ts` | The functions a page calls to save something. Thin: check input, call the domain module, refresh the page. |
| API routes | `src/app/api/<area>/.../route.ts` | URLs called by outside systems (Sage poller, webhooks, the mobile app, file downloads). |
| Pages | `src/app/dashboard/...` | Each folder is a URL. `src/app/dashboard/projects/[id]/estimate/page.tsx` is `/dashboard/projects/<id>/estimate`. |
| UI components | `src/components/<area>/` | The React pieces those pages are built from. |

Why it is split this way, and the rules that keep it tidy (one writer per table,
foreign keys, additive migrations, size limits), are in the
[architecture and data standard](../development/architecture-standards.md).
Automated tests enforce most of it.

Other starting points:

- [Architecture overview](overview.md): the two layers (Compass Core and HPS
  modules) and the tech stack.
- [Data layer](data-layer.md): Drizzle and D1 conventions.
- [Server actions](server-actions.md): the save pattern.
- [Server bundle](server-bundle.md): how the code becomes one Cloudflare
  Worker, and the memory limit.
- [UI standards](../development/ui-standards.md): how screens must look and
  behave.
- [docs/README.md](../README.md): every other document.


Finding things quickly
---

- **From a screen**: copy the URL path after the domain, then open the same
  folders under `src/app/`. The `page.tsx` there imports the components it
  uses, and the components import the server actions they call.
- **From a database table**: search for the SQL table name in `src/db/`
  (for example `"daily_logs"`) to find its Drizzle name (`dailyLogs`). Then
  search for `insert(dailyLogs)` to find the `store.ts` that writes it.
- **From a Settings option**: search the label text in
  `src/lib/feature-settings/registry.ts`, or in `src/components/settings/`.
- **From a status value**: open `src/lib/domain/<area>/statuses.ts`.


Domains
---

Each section lists real paths. "Actions" and "components" usually match by
name prefix, so `src/app/actions/project-rfis.ts` goes with
`src/components/projects/project-rfi*.tsx`.

### Projects (jobs)

The job record itself: number, name, department, status, address, map
visibility, members, linked jobs and job families.

- Schema: `src/db/schema-projects.ts` (`projects`, numbering, aliases, job
  statuses, members, access grants, travel charges), `src/db/schema-project-families.ts`,
  `src/db/schema-project-links.ts`, `src/db/schema-project-archives.ts`,
  `src/db/schema-job-workflows.ts`
- Domain: `src/lib/domain/project/` (projects, numbering, intake, job status),
  `src/lib/domain/families/`, `src/lib/domain/project-audit/`,
  `src/lib/domain/workflows/`
- Other logic: `src/lib/projects/`, `src/lib/project-*.ts`,
  `src/lib/portfolio-map/`, `src/lib/job-workflows/`
- Actions: `src/app/actions/projects.ts`, `project-profile.ts`,
  `project-registry*.ts`, `project-families.ts`, `project-links.ts`,
  `project-bulk-status.ts`, `project-duplicates.ts`, `job-workflows.ts`,
  `portfolio-map.ts`
- Pages: `src/app/dashboard/projects/page.tsx` (the list),
  `src/app/dashboard/projects/[id]/` (one folder per project tab:
  `information`, `contacts`, `schedule`, `estimate`, `budget`, `financials`,
  `documents`, `photos`, `daily-logs`, `todos`, `purchase-orders`, `rfis`,
  `rfqs`, `selections`, `change-orders`, `warranty`, `messages` and more)
- Components: `src/components/projects/`, `src/components/dashboard/`
  (dashboard, portfolio map)
- Docs: [portfolio map](../modules/portfolio-map.md),
  [multi-tenancy](multi-tenancy.md)

### Estimates and change orders

Estimates with lines, assemblies and phases; bids and selected trades;
acceptance and e-signature; change orders and variances; templates.

- Schema: `src/db/schema-estimates.ts`, `src/db/schema-change-orders.ts`, `src/db/schema-templates.ts`, `src/db/schema-rate-book.ts`,
  `src/db/schema-rfqs.ts`
- Domain: `src/lib/domain/estimates/`, `src/lib/domain/templates/`
- Other logic: `src/lib/estimates/`, `src/lib/change-orders/`,
  `src/lib/rate-book/`, `src/lib/rfqs/`, `src/lib/templates/`
- Actions: `src/app/actions/project-estimates.ts`, `estimate-*.ts`,
  `project-change-order*.ts`, `project-variances.ts`, `estimate-templates.ts`,
  `project-templates.ts`, `rate-book.ts`, `project-rfq*.ts`
- API: `src/app/api/projects/[id]/estimates/`,
  `src/app/api/projects/[id]/change-orders/`
- Pages: `src/app/dashboard/projects/[id]/estimate/`,
  `.../change-orders/`, `.../rfqs/`, `src/app/dashboard/templates/`
- Components: `src/components/projects/estimate-workspace/`,
  `src/components/projects/project-estimate*.tsx`, `src/components/rfqs/`,
  `src/components/templates/`, `src/components/rate-book/`
- Docs: [estimate report phases](../modules/estimate-report-phases.md),
  [rate book](../modules/rate-book.md)

### Financials: budgets, pay requests, invoices, payments

Contract budgets, pay applications (pay requests), deposits, simple invoices,
received payments, vendor bills, Square receipts.

- Schema: `src/db/schema-financials.ts` (budget applications, budget lines,
  contract deposits, Sage cost codes), `src/db/schema-netsuite.ts` (invoices, vendor
  bills, payments, credit memos: legacy NetSuite columns),
  `src/db/schema-contracts.ts`, `src/db/schema-shop-tickets.ts`
- Domain: `src/lib/domain/budget/` (budget lines and pay applications),
  `src/lib/domain/financials/` (invoices, payments, contract budget)
- Other logic: `src/lib/financials/`, `src/lib/billing/`, `src/lib/deposits/`,
  `src/lib/contracts/`, `src/lib/shop-tickets/`
- Actions: `src/app/actions/project-budget.ts`, `project-contract-*.ts`,
  `pay-application-billing.ts`, `sage-pay-*.ts`, `project-invoices.ts`,
  `invoices.ts`, `payments.ts`, `received-payments.ts`, `vendor-bills.ts`,
  `credit-memos.ts`, `shop-ticket*.ts`, `contract-*.ts`
- API: `src/app/api/projects/[id]/pay-applications/`,
  `src/app/api/projects/[id]/contracts/`
- Pages: `src/app/dashboard/projects/[id]/budget/`, `.../financials/`
  (invoices, pay applications), `.../contracts/`, `.../shop-tickets/`,
  `src/app/dashboard/financials/`
- Components: `src/components/financials/`
- Docs: [financials](../modules/financials.md),
  [contracts](../modules/contracts.md),
  [shop tickets](../modules/shop-tickets.md)

### Sage bridge (accounting)

Compass never talks to Sage 100 Contractor directly from the website. Compass
puts requests in queue tables; a poller on the Sage PC claims them through
signed API routes, runs an approved writer program, and reports back.

- Schema: `src/db/schema-sage.ts` (queues, read models, links to Sage
  records)
- Domain: `src/lib/domain/sage-bridge/` (queue writes, AR invoices, change
  orders, estimates, contacts, Square)
- Other logic: `src/lib/sage/` (bridge auth, Sage read/write helpers, Square)
- Actions: `src/app/actions/sage-*.ts`, `project-sage-*.ts`,
  `project-deposit-sage.ts`
- API (called by the Sage PC): `src/app/api/integrations/sage/`
  (one folder per queue: `ar-invoices`, `change-orders`, `contact-changes`,
  `estimates`, `pay-applications`, `square-payments`, ...),
  `src/app/api/integrations/square/`, `src/app/api/operations/sage/`
- Programs that run on the Sage PC: `scripts/sage_*.py` (pollers),
  `scripts/Sage.100.Contractor.Compass*Writer.cs` (writers)
- Settings: `src/lib/feature-settings/sage-*-settings.ts`,
  `src/components/settings/sage-*-settings-section.tsx`
- Docs: [Sage API bridge notes](../wip/sage-api-bridge-2026-05-14.md)

### Contacts, customers and vendors

The company directory (customers, vendors, their people, staff), project
contacts, invitations to the owner and vendor portals, duplicate merges.

- Schema: `src/db/schema-contacts.ts` (project contacts, customers, vendors,
  their people, staff, merge events), `src/db/schema-crm.ts` (notes,
  interactions, follow-ups),
  `src/db/schema-participants.ts`
- Domain: `src/lib/domain/contacts/`, `src/lib/domain/identity/`
  (alternate emails), `src/lib/domain/crm/` (notes, interactions,
  follow-ups)
- Other logic: `src/lib/contact-*.ts`, `src/lib/project-contact-*.ts`,
  `src/lib/client-follow-up/`, `src/lib/client-interactions/`
- Actions: `src/app/actions/contact-*.ts`, `customers.ts`, `vendors.ts`,
  `project-contacts.ts`, `project-access-invitations.ts`,
  `unassigned-people.ts`, `client-follow-up.ts`
- Pages: `src/app/dashboard/contacts/`, `src/app/dashboard/customers/`,
  `src/app/dashboard/vendors/`, `src/app/dashboard/projects/[id]/contacts/`
- Components: `src/components/contacts/`,
  `src/components/projects/contact-editor/`, `src/components/people/`

### Field: daily logs, photos, owner updates, Field Mode

- Schema: `src/db/schema-field.ts` (daily logs, photos and aliases, owner
  updates, daily log reminders, videos), `src/db/schema-internal-duties.ts`,
  `src/db/schema-equipment.ts`
- Domain: `src/lib/domain/field/`, `src/lib/domain/media/`,
  `src/lib/domain/duties/`
- Other logic: `src/lib/daily-logs/`, `src/lib/field/`, `src/lib/photos/`,
  `src/lib/owner-updates/`, `src/lib/videos/`
- Actions: `src/app/actions/project-field.ts`, `project-photos.ts`,
  `daily-log-*.ts`, `field-*.ts`, `project-videos.ts`, `equipment.ts`,
  `internal-duties.ts`
- API (the phone app): `src/app/api/field/`
- Pages: `src/app/dashboard/projects/[id]/daily-logs/`, `.../photos/`,
  `.../owner-updates/`, `.../videos/`, `src/app/dashboard/field/`
- Components: `src/components/projects/daily-log/`,
  `src/components/projects/photo-review/`, `src/components/field/`
- The offline phone shell: `mobile-shell-src/` (built by
  `bun run mobile:build`), native projects in `ios/` and `android/`
- Docs: [mobile](../modules/mobile.md), [native mobile](native-mobile.md)

### Schedule and calendars

- Schema: `src/db/schema-schedule.ts` (schedule tasks, links, dependencies,
  baselines, publications), `src/db/schema-calendars.ts` (work calendar,
  Google calendars, My Compass and project calendars, client meetings)
- Domain: `src/lib/domain/schedule/`, `src/lib/domain/work-calendar/`,
  `src/lib/domain/calendars/`
- Other logic: `src/lib/schedule/` (critical path, Gantt),
  `src/lib/project-calendars/`, `src/lib/my-compass-calendar/`,
  `src/lib/google/` (calendar sync)
- Actions: `src/app/actions/schedule*.ts`, `work-calendar.ts`,
  `project-calendars.ts`, `my-compass-calendar.ts`, `google-calendar.ts`
- Pages: `src/app/dashboard/schedule/`,
  `src/app/dashboard/projects/[id]/schedule/`
- Components: `src/components/schedule/`
- Docs: [scheduling](../modules/scheduling.md)

### Operations: to-dos, purchase orders, RFIs, selections, warranty

- Schema: `src/db/schema-operations.ts` (`project_operations` holds to-dos
  and purchase orders; purchase order lines, RFIs),
  `src/db/schema-selections.ts` (finish selections),
  `src/db/schema-selection-decisions.ts`, `src/db/schema-selection-choices.ts`
  (choices, supplier links, photo links, comments, follow-up selections),
  `src/db/schema-warranty.ts`,
  `src/db/schema-trade-docs.ts`
- Domain: `src/lib/domain/operations/`, `src/lib/domain/rfis/`,
  `src/lib/domain/selections/`, `src/lib/domain/warranty/`,
  `src/lib/domain/trade-letters/`
- Actions: `src/app/actions/project-operations.ts`, `project-todos.ts`,
  `project-purchase-orders.ts`, `project-rfis.ts`, `project-selections.ts`,
  `selection-*.ts`, `project-warranty*.ts`, `vendor-trade-doc*.ts`,
  `trade-letters.ts`
- Pages: `src/app/dashboard/projects/[id]/todos/`, `.../purchase-orders/`,
  `.../rfis/`, `.../selections/`, `.../warranty/`,
  `src/app/dashboard/purchase-orders/`, `src/app/dashboard/rfis/`
- Components: `src/components/projects/`, `src/components/purchase-orders/`,
  `src/components/selections/`, `src/components/trade-docs/`

### Documents and Google Drive

- Schema: `src/db/schema-documents.ts`, `src/db/schema-google.ts`,
  `src/db/schema-paper-trail.ts`
- Domain: `src/lib/domain/documents/`
- Other logic: `src/lib/google/`, `src/lib/files/`, `src/lib/paper-trail/`,
  `src/lib/print/` (Print Preview)
- Actions: `src/app/actions/project-documents.ts`, `google-drive.ts`,
  `drive-picker.ts`, `paper-trail.ts`, `print-snapshots.ts`
- Pages: `src/app/dashboard/files/`,
  `src/app/dashboard/projects/[id]/documents/`, `src/app/print/`
- Components: `src/components/files/`, `src/components/google/`,
  `src/components/print/`, `src/components/paper-trail/`
- Docs: [Google Drive](../modules/google-drive.md),
  [paper trail](../modules/paper-trail.md)

### Nu-Tech orders

Fox Blocks catalog, takeoffs, bracing rentals, manufacturer purchase orders.

- Schema: `src/db/schema-nutech.ts`
- Domain: `src/lib/domain/nutech/`
- Other logic: `src/lib/nutech/`
- Actions: `src/app/actions/nutech-*.ts`
- API: `src/app/api/projects/[id]/nutech-order-form/`
- Pages: `src/app/dashboard/nutech/`, `src/app/dashboard/projects/[id]/nutech/`
- Components: `src/components/nutech/`
- Docs: [Nu-Tech](../modules/nutech.md)

### Conversations, email and notifications

Chat channels and project messages, tracked outside email (replies come back
to the record), notifications, Activity, the staff Message Desk.

- Schema: `src/db/schema-conversations.ts`,
  `src/db/schema-correspondence*.ts`, `src/db/schema-project-email.ts`,
  `src/db/schema-notifications.ts` (notifications, email reply threads,
  inbound email, Activity, push tokens), `src/db/schema-feedback.ts`
  (Message Desk, GoTo calls and texts)
- Domain: `src/lib/domain/conversations/`,
  `src/lib/domain/correspondence/`, `src/lib/domain/notifications/`,
  `src/lib/domain/feedback/` (Message Desk and feedback)
- Other logic: `src/lib/conversations/`, `src/lib/correspondence/`,
  `src/lib/email/`, `src/lib/notifications/`, `src/lib/push/`,
  `src/lib/staff-message-desk/`
- Actions: `src/app/actions/conversations.ts`, `project-messages.ts`,
  `project-correspondence.ts`, `notifications.ts`, `activity.ts`,
  `staff-message-desk.ts`, `*-email.ts`
- API: `src/app/api/conversations/`, `src/app/api/email/`,
  `src/app/api/notifications/`, `src/app/api/push/`
- Pages: `src/app/dashboard/conversations/`,
  `src/app/dashboard/projects/[id]/messages/`, `src/app/dashboard/activity/`
- Components: `src/components/conversations/`,
  `src/components/correspondence/`, `src/components/notifications/`,
  `src/components/email/`, `src/components/staff-message-desk/`
- Docs: [email workflow standard](../development/email-workflows.md),
  [conversations](../modules/conversations.md),
  [project email](../modules/project-email.md)

### Buildertrend import

Records copied from Buildertrend before the cutover. Staging tables are
evidence and are never edited by hand.

- Schema: `src/db/schema-buildertrend.ts`,
  `src/db/schema-correspondence-source.ts`
- Domain: `src/lib/domain/buildertrend/`
- Other logic: `src/lib/buildertrend/`
- Scripts: `scripts/*buildertrend*.mjs`
- Docs: [Buildertrend PDF import](../development/buildertrend-pdf-import.md)

### Help (user guides)

- Content: `docs/help/guides/*.md` (the articles; edit these)
- Generated data: `src/lib/help/help-guides.generated.ts`
  (`bun run help:generate`)
- Logic: `src/lib/help/`
- Pages: `src/app/dashboard/help/`
- Components: `src/components/help/`
- Docs: [help authoring](../help/README.md),
  [help system](../development/help-system.md),
  [help videos](../development/help-videos.md)

### Settings

Company settings (everything under Settings) and per-person preferences.

- Schema: `src/db/schema-settings.ts` (`organization_feature_settings`,
  saved views, list sheet settings, view preferences), `src/db/schema-record-statuses.ts`,
  `src/db/schema-theme.ts`
- Feature settings: `src/lib/feature-settings/` (registry and readers)
- Domain: `src/lib/domain/settings/` (saved views, list sheets),
  `src/lib/domain/record-statuses/`
- Actions: `src/app/actions/feature-settings.ts`, `record-statuses.ts`,
  `view-preferences.ts`, `list-sheets.ts`, `themes.ts`
- Page: `src/app/dashboard/settings/page.tsx`
- Components: `src/components/settings/` (`settings-page.tsx` plus one
  `*-settings-section.tsx` per group)
- Docs: [theming](../development/theming.md)

### Sign-in, users, teams and permissions

- Schema: `src/db/schema-identity.ts` (users, organizations, members,
  invites, teams, groups, permission overrides, account deletion requests)
- Domain: `src/lib/domain/identity/`
- Other logic: `src/lib/auth.ts` (WorkOS, `getCurrentUser()`),
  `src/lib/permissions.ts` (who may do what),
  `src/lib/permission-enforcement.ts`, `src/lib/server/action-context.ts`
  (the shared start of every action), `src/middleware.ts` (redirects signed
  out visitors)
- Actions: `src/app/actions/users.ts`, `organizations.ts`, `invites.ts`,
  `permission-overrides.ts`, `profile.ts`
- API: `src/app/api/auth/`
- Pages: `src/app/(auth)/` (login, signup, invite, reset password)
- Components: `src/components/auth/`,
  `src/components/settings/permissions-tab.tsx`,
  `src/components/settings/team-tab.tsx`
- Docs: [auth system](auth-system.md), [multi-tenancy](multi-tenancy.md)

### Jarvis (the AI assistant) and feedback

- Schema: `src/db/schema-agent.ts`, `src/db/schema-ai-config.ts`,
  `src/db/schema-jarvis.ts`, `src/db/schema-mcp.ts`,
  `src/db/schema-plugins.ts`, `src/db/schema-agent-memory.ts`,
  `src/db/schema-feedback.ts` (feedback reports)
- Logic: `src/lib/agent/`, `src/lib/jarvis/`, `src/lib/mcp/`,
  `packages/agent-core/`, `packages/agent-server/`
- API: `src/app/api/agent/`, `src/app/api/compass/`,
  `src/app/api/integrations/jarvis/`, `src/app/api/bridge/`
- Components: `src/components/agent/`, `src/components/ai/`,
  `src/components/feedback/`
- Docs: [AI agent](ai-agent.md),
  [Jarvis feedback bridge](jarvis-feedback-bridge.md)

### Smaller areas

| Area | Where |
|------|-------|
| CHERISH board and greeting cards | `src/db/schema-cherish.ts`, `src/lib/cherish/`, `src/lib/greeting-cards/`, `src/app/actions/cherish-*.ts`, `src/components/cherish/`; [greeting cards](../modules/cherish-cards.md) |
| Weather and fire map layers | `src/db/schema-weather.ts`, `src/lib/weather/`, `src/lib/domain/weather/`, `src/app/api/operations/weather/` |
| Social posts | `src/db/schema-social.ts`, `src/lib/social/`, `src/app/api/social/`; [social publishing](../modules/social-publishing.md) |
| Listening Room and Office Talk | `src/lib/listening-room*.ts`, `src/lib/realtimekit/`, `src/components/voice/`, `src/app/api/realtimekit/` |
| Internal workspaces and duties | `src/db/schema-internal-duties.ts`, `src/lib/domain/duties/`; [internal workspaces](../modules/internal-workspaces.md) |
| Desktop app | `electron/`; [desktop](../modules/desktop.md) |
| NetSuite (legacy) | `src/lib/netsuite/`; [NetSuite](../modules/netsuite.md) |


Folder conventions
---

- **`src/lib/domain/<area>/`** owns the tables of one area. Only its
  `store.ts` (or files it names) may insert, update or delete those tables.
  `rules.ts` has no database access, so it can be tested and used in the
  browser. `statuses.ts` holds the `as const` lists of allowed values that the
  schema's `enum:` uses.
- **`src/lib/<area>/`** (outside `domain/`) is shared logic, integrations and
  read helpers. `src/lib` never imports from `src/app`.
- **`src/app/actions/`** has one file per feature, each starting with
  `"use server"`. Actions return `{ success: true, ... }` or
  `{ success: false, error }`.
- **`src/app/api/`** routes are for callers that are not a Compass page:
  the Sage PC, webhooks (Square, Foxit, GoTo), the phone app, downloads.
- **`src/components/ui/`** are the shared building blocks (shadcn/ui).
  Feature components live in a folder named after the feature.
- **`src/db/`** holds the schema files and the database entry point
  (`src/db/index.ts`). Each `schema-*.ts` file holds one area's tables and
  starts with a comment listing them. `src/db/schema.ts` only re-exports the
  core area files, so code can keep importing from `@/db/schema`. A new
  schema file must be added to `drizzle.config.ts`.
- **`drizzle/`** holds the migrations. `scripts/` holds one-off and
  maintenance scripts (imports, reports, the Sage PC programs).
- **Tests** sit next to the code in `__tests__/` folders. End-to-end tests are
  in `e2e/`.


How to add a company setting
---

Every rule or threshold should be editable per company in Settings (with a
sensible default). Settings are stored as one JSON value per group in the
`organization_feature_settings` table, so **a new setting needs no
migration**.

1. Add the setting's shape and default. For a small group, add a Zod schema in
   `src/lib/feature-settings/registry.ts`. For a bigger one, create
   `src/lib/feature-settings/<name>-settings.ts` (see
   `simple-invoice-settings.ts`) and import it into the registry.
2. Register the group: add its key and type to `FeatureSettingsTypes` and an
   entry to `FEATURE_SETTINGS` with `label`, `description`, `defaults` and
   `schema` (and `editorRoles` if only some roles may edit it).
3. Read it on the server with `readFeatureSettings(db, organizationId, key)`
   from `src/lib/feature-settings/server.ts`. Stored values are merged over the
   defaults, so new fields get their default automatically.
4. Add the editor: a `*-settings-section.tsx` in `src/components/settings/`
   that loads with `getFeatureSettingsForEditor(key)` and saves with
   `saveFeatureSettings(key, value)` from
   `src/app/actions/feature-settings.ts`. Show it from the right tab (for
   example `workflows-tab.tsx`, which `settings-page.tsx` renders).
5. Update the matching help guide in `docs/help/guides/` and run
   `bun run help:generate`.


How to add a migration
---

Migrations are hand-written SQL files. They must only **add** things (tables,
columns, indexes, triggers); D1 cannot safely drop or rebuild a table. See
"Migrations" in the [architecture standard](../development/architecture-standards.md).

1. Change the table in the right `src/db/schema*.ts` file first.
2. Create the next numbered file in `drizzle/`, for example
   `drizzle/0310_short_name.sql`, with a comment saying why. Use
   `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN`,
   `CREATE INDEX IF NOT EXISTS`. Look at the latest few files for the style.
3. Run `bunx vitest run src/db/__tests__/schema-integrity-standard.test.ts`.
   It replays every migration on an empty database and fails if the result
   does not match the schema files (missing column, index, foreign key).
4. Apply locally with `bun run db:migrate:local`.
5. After the PR merges, apply to production from an up-to-date `main`
   checkout with `bun run db:migrate:prod`. Check the pending list Wrangler
   prints before confirming. Production can have columns from earlier work, so
   read the live schema before an `ALTER TABLE`.

`bun run db:generate` (Drizzle Kit) is not used for new migrations any more:
its snapshot files in `drizzle/meta/` stopped being updated long ago.


How deploys work
---

Compass runs on Cloudflare Workers. Cloudflare's Workers Builds integration
also builds every push (the "Workers Builds: compass" check on a PR), but the
dependable way to put the latest `main` live is to deploy by hand after the
PR merges:

1. Merge the PR to `main` once CI is green (`.github/workflows/`: lint, knip,
   UI standards, help check, build, unit tests, E2E).
2. From a clean checkout of the latest `main`, run
   `NODE_OPTIONS=--max-old-space-size=8192 bun run deploy`. This builds with
   OpenNext, escapes non-ASCII characters in the bundle, and uploads the
   Worker (`wrangler.jsonc`, Worker name `compass`).
3. Apply any new migrations (`bun run db:migrate:prod`) before or right after
   deploying, depending on whether the old code tolerates the new columns.
4. Check the site loads (`/login` returns 200) and watch live errors for a few
   minutes with `npx wrangler tail compass --format json`.

The demo copy is a separate Worker; see
[demo environment](../development/demo-environment.md). How the build turns
into one Worker file, and the memory limit to watch, is in
[server bundle](server-bundle.md). Local setup is in
[getting started](../development/getting-started.md).
