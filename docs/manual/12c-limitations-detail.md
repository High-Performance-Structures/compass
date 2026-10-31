## 12.2 Architecture cleanup still open

- **Hand-rolled context.** Most of the remaining action files and API routes still resolve the user, organization and database by hand (the `handRolledContext` count). The next step is to move each area onto `orgContext` or `projectContext` in a pull request scoped to that area.
- **Writers outside domain stores.** These include calendar sync (`my_compass_calendar_items`, `compass_project_calendar_*`), project email campaigns, permission audit events, plugin events, rate-book history and equipment logs. Each should move into its owning `store.ts`. The architecture baseline lists every writer file.
- **Tables without a domain store.** Many tables (for example notifications preferences, travel charges, and weather caches written by library code) are still written by library modules instead of a domain store. Assign each one an owning domain.
- **Large files and type escapes.** Split the files that are over 800 lines, and replace `as` and `!` with type guards. Both counts can only fall.
- **Schema comments.** Most tables have no comment that describes their purpose. Appendix A fills the gap from a curated list (`scripts/manual/table-purposes.json`) and marks those descriptions. Add a one-line purpose comment above each `sqliteTable(...)` when a pull request touches that table, then delete its curated entry.
- **Internal ids without foreign keys.** Migration 0281 put validation triggers on 72 such columns, and 66 are exempt with a reason. The remaining needs-review columns (section 12.1) need their orphans cleaned up (`scripts/orphan-id-report.mjs`) before they get triggers.

## 12.3 Data-model consolidation

`docs/development/data-model-consolidation.md` is the approved plan. Every step is additive and follows the same six-step recipe:

1. create;
2. dual-write in the same `db.batch`;
3. dry-run backfill;
4. switch reads;
5. freeze the old writers;
6. keep the old tables.

| Order | Area | Problem | Effort (hours) | Risk |
|---|---|---|---|---|
| 1 | Saved views | Project views, schedule views and view preferences are three stores for one concept | 8–10 | Low |
| 2 | JSON id lists | Owner-update source logs and photos, draft recipients and attachments, meeting attendees, RFQ cc and links, cost codes, template departments, signers. Deleting a log or photo can leave a dangling id in a draft | 27–36 | Low–medium |
| 3 | Audit and activity | Several event and audit tables, some written outside their owners | 22–28 | Medium–low |
| 4 | Calendars | Overlapping calendar tables, three of them unused | 28–36 | Medium |
| 5 | Email transport | Reply threads, inbound mail, correspondence deliveries, RFQ deliveries and campaigns overlap | 36–48 | High |

The plan also lists what must stay separate and why. For example, a client meeting is a business record, not a calendar slot, and a project's correspondence is the record while email is only how it travels.

**Copied party text.** Migration 0280 linked client, vendor and RFI-assignee copies to the contacts directory. Other copied fields remain (for example names and emails on meetings, contracts and correspondence) and should follow the same pattern: a nullable foreign key, an exact-match backfill, and the old text kept as a fallback or named snapshot.

## 12.4 Company-neutrality gaps

Compass is meant to be adopted by any company. The following values are still built into the code and should move into Settings:

- **Departments and job-number prefixes.** The four department codes and the job-number pattern are built into the schema enum and `src/lib/project-profile.ts`. They should become company data: a department table with its prefix, name and modes.
- **The values board.** Its value names are a TypeScript union, and its display name appears in UI strings. Make the board name and the value list company settings.
- **Legacy module names.** The product sales / online ordering module and the values board use a company-specific folder, table prefix and identifier prefix (`{sales}` and `{values}` in this manual). Rename the code folders and identifiers. Keep the existing tables and add neutral views, because tables cannot be renamed safely on D1.
- **Accounting handoff payload.** One accounting handoff payload contains a hard-coded company name (`src/lib/domain/project/rules.ts`). Read it from the department profile instead.
- **Hard-coded defaults.** A per-person desk-photo default in the dashboard launchpad and the mobile app's bundle id and host list are fixed in code. Make them configurable at build or deployment time.
- **Weather and maps.** Weather and maps assume United States public data services and US states. Other regions need regional providers behind the same functions (section 7.5).
- **Built-in job statuses.** The built-in status changer accepts only built-in ids, even though companies can add custom statuses (`src/lib/domain/project/job-status.ts`).

## 12.5 Product and correctness gaps found while writing this manual

- **Unvalidated statuses.** RFI status: the schema default (`open`) is not one of the `RfiStatus` values (`new` and so on). Invoice, bill and credit-memo statuses are checked only by the UI dropdowns, not on the server.
- **Free-text template fields.** Template kind, lifecycle and review status are free text with no shared `as const` list.
- **Money columns.** AR, AP and pay-application amounts are stored as `real` dollars, while estimates and deposits use integer cents. Convert them additively to cents.
- **Two status columns.** `projects.status` (default `OPEN`) sits beside `job_status_id`, and how the two relate is not documented. Treat `job_status_id` as authoritative.
- **Incomplete accounting connector.** Change orders and purchase orders can be marked as waiting for accounting sync, but no automated writer consumes those queues yet. The handoff is manual.
- **No payments interface.** There is no generic payments interface. The card-payment adapter is wired directly into the accounting-bridge modules.
- **Retired offline sync.** The desktop offline queue still exists, but the server sync endpoints are retired.
- **Stale docs.** Older docs disagree with the code in places: the assistant's provider file, conversation mentions, paper-trail record types and a public `/demo` session. This manual follows the code.

## 12.6 Security follow-ups

- Add a nonce, or a short replay cache, to the scheduled-job and agent-bridge HMAC. The accounting bridge already has one.
- Move the SMS webhook secret and the e-sign signature out of query strings where the providers allow it.
- Replace the `/api/google/*` and `/api/netsuite/*` public prefixes with exact public paths.
- Move the accounting PC's secrets from machine environment variables into a credential vault.
- Use a separate signing key for social-media links instead of reusing the social token encryption key.

## 12.7 Open issues (at this edition)

These are tracked in the repository's issue list:

| Area | Issue |
|---|---|
| Platform | The production worker intermittently drops requests (stuck server actions); smoke tests use retries while this is investigated |
| Identity | Hosted invitation emails show the identity provider's default branding instead of the product name. This is fixed in the provider's dashboard, not in code |
| Contacts | Guarded duplicate merging for client and vendor companies and people (partly delivered) |
| Schedule | Choosing an end date directly instead of a duration |
| Correspondence | Separating external email from internal chat in the project mail view |
| Notifications | Notifying staff when they are assigned a to-do (partly delivered through daily-log follow-ups) |
| Accounting | Read-only progress-billing (G703) synchronization beyond the snapshot; a guarded change-order request workflow with a later e-sign handoff |
| Audiences | Reconciling owner and vendor project audiences for imported legacy messages |
| Feedback desk | Automating lifecycle updates and routing confirmed bugs into delivery |
| CI | One schema test cannot import the Bun SQLite module under Vitest |

## 12.8 Roadmap summary

1. Finish the architecture cleanup: hand-rolled context, writers outside stores, large files, type escapes, foreign keys and schema comments, with ratchets that only fall.
2. Consolidate the data model in the approved order.
3. Close the company-neutrality gaps: departments and prefixes as data, a configurable values board, neutral module names.
4. Apply the shared record-list standard to every growing list (section 4.7).
5. Add the performance options in the order given in section 10.3, driven by measurements.
6. Extend the adapters: an accounting connector for change orders and POs, a payments interface, and regional weather.
