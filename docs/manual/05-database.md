# 5. Database structure

## 5.1 Overview

- **Engine.** Compass stores everything relational in one Cloudflare D1 database, which is SQLite.
- **Schema.** The schema is declared with Drizzle ORM across the `src/db/schema*.ts` files, plus `src/lib/sync/schema.ts`. Every one of those files is listed in `drizzle.config.ts`.
- **Size.** At this edition there are **314 tables**. Appendix A describes every table, column, index and writer.
- **Migrations.** Migrations are hand-reviewed SQL files in `drizzle/` named `NNNN_description.sql`. There are 273 at this edition, the latest being `0281_id_reference_triggers.sql`. Wrangler applies them in file-name order and records them in its migrations table. A few early numbers were used twice (for example 0108 and 0144), so a new migration takes the next unused number after the highest one.
- **Development and test.** Locally, and in E2E runs, the same migrations are applied to a SQLite file (`bun run db:init-local`). `src/lib/domain/__tests__/sqlite-d1.ts` gives store tests a real SQLite database behind the D1 interface.

## 5.2 Conventions

| Convention | Rule |
|---|---|
| Identifiers | Primary keys are text, usually UUIDs. Users are keyed by the identity provider's user id. Sequential human numbers (job, CO, PO, RFQ, RFI) are separate columns with unique indexes per organization |
| Dates | ISO 8601 text. Date-only values (`YYYY-MM-DD`) are parsed with `parseDateOnly`, never `new Date()` |
| Money | Integer cents (`*_cents`, or `integer` amounts in estimates, deposits and payment operations). Rates are basis points. Older AR/AP and pay-application tables still use `real` dollars (chapter 12) |
| Booleans | `integer` with `{ mode: "boolean" }` |
| Organization scoping | Every table that holds company data has `organization_id` (FK to `organizations`), or reaches it through `project_id`. Every query filters in SQL |
| Foreign keys | Every internal `*_id` or `*_by` column uses `.references()` (older columns that cannot get one on D1 have validation triggers instead, `src/db/id-integrity.ts`) with an explicit `ON DELETE` (`cascade` for owned children, `set null` for actors and optional links). Ids from outside systems are exempt by prefix (`google_*`, `sage_*`, `square_*`, `foxit_*`, `workos_*`, `buildertrend_*`, and so on). A reference that must survive deletion carries an `// fk-exempt:` comment with the reason |
| Indexes | Every foreign-key column leads an index. Hot queries have covering indexes, and a planner test protects them from falling back to scans |
| Uniqueness | Link tables are unique on their pair. Imported rows are unique on `(source_system, source_*_id)` or `(organization_id, source_key)`. Human numbers are unique per organization |
| Status, type, kind and role lists | `text("status", { enum: STATUSES })` with an exported `as const` array shared with the code. Values are lower case with one spelling per concept. Appendix D.2 lists the vocabularies |
| Snapshots vs links | Point to a person, company, contact, vendor, customer or project by id; never copy their name, email, phone or address. A value that must stay as it was when a document was signed, sent or approved is a *snapshot*: it is named `*_snapshot` or carries a `// snapshot:` comment |
| JSON | Lists of records are child rows, not JSON. JSON columns are only for raw provider payloads and named snapshots, and carry a `// json:` comment |
| Polymorphic references | Last resort. A `*_type` + `*_id` pair names its allowed types in a shared constant, and a trigger or per-type FK column checks that the target exists |
| Audit and history | Domain history tables (`project_change_order_history`, `project_todo_events`, `project_profile_audit_events`, `project_contract_budget_revisions` and so on) are written in the same batch as the change they record. `activity_events` is the cross-cutting timeline |
| Soft delete | Records with financial or legal meaning are voided or archived, never deleted (change orders, pay applications after billing, issued shop tickets). Other records have a guarded delete |

## 5.3 Migration rules

1. **Additive only.** Add tables, columns, indexes, views and validation triggers. Never `DROP TABLE`, never rebuild a table, and never `ALTER` an existing column's type or constraints in production.
2. **Never rebuild a table on D1.** SQLite's "create new table, copy, drop old, rename" pattern is unsafe on D1. Dropping a parent table cascades to its children or leaves foreign keys switched off, and D1 has no transaction around a whole migration file that would let you recover.
3. **Adding a constraint that an existing column lacks.** Use a validation trigger (`BEFORE INSERT` / `BEFORE UPDATE` that calls `RAISE(ABORT, …)`), or add a new foreign-key column plus a backfill. Two recent examples: migration 0280 adds nullable foreign-key columns with indexes, plus `BEFORE INSERT/UPDATE` triggers that keep each new link inside the record's own company; migration 0281 adds insert and update validation triggers to 72 existing id columns that could not be given a foreign key. Each column is classified in `src/db/id-integrity.ts` as triggered, exempt (with a reason) or needs review. Run `scripts/orphan-id-report.mjs` before adding triggers, because an update that sets an orphaned id again will abort.
4. **The schema files are the source of truth.** Every table, column and index in a migration is also declared in Drizzle. CI replays all migrations and compares the result with the schema in both directions.
5. **Data changes are separate.** A migration that changes or deletes existing rows, such as removing duplicates before adding a unique index, needs explicit approval and its own PR. Prefer an idempotent script with a dry-run default.
6. **At most 100 bound parameters per statement.** This applies to migrations, scripts and application code alike. Use `chunkD1Values` for `IN` lists, and `chunkD1Rows` / `chunkD1InsertRows` for multi-row inserts. `chunkD1InsertRows` counts every column the table can bind, because Drizzle binds defaults too.
7. **No giant UNIONs.** Never build one statement with dozens of `UNION ALL` branches or `OR` clauses across tables. A 150-branch audit query once reset the production database. Run audits as many small, indexed queries, in batches.
8. **Check production before you `ALTER`.** Production may already have columns from migrations on branches that were never merged. Run `PRAGMA table_info` against production and use `IF NOT EXISTS` where SQLite allows it (section 9.2).
9. **Never edit an applied migration.** Write a new one.

## 5.4 How the tables group by domain

Each table belongs to one diagram, chosen from the domain module that writes it. Tables that no domain store writes yet are placed by name. The diagrams show only primary-key and foreign-key columns; every column is in Appendix A.

| Domain | Main tables |
|---|---|
| Identity, organizations and permissions | `users`, `organizations`, `organization_members`, `teams`, `team_members`, `groups`, `project_access_invitations`, `*_permission_overrides`, `permission_audit_events` |
| Projects | `projects`, `project_members`, number reservations, aliases and retirements, `project_job_statuses`, `project_links`, `project_families`, `project_family_phases`, `project_profile_audit_events` |
| Estimates and change orders | `project_estimates` (+ lines, cost items, assemblies, phase proposals), `project_change_orders` (+ lines, documents, history), `trade_letters`, `rate_book_entries` |
| Contracts, budgets and financials | `project_contract_budget_revisions` / `_lines`, `project_budget_applications` / `_lines`, `project_contract_deposits`, `invoices`, `payments`, `vendor_bills`, `credit_memos`, `shop_tickets` |
| Operations | `project_operations` (to-dos, RFQs, POs), `project_purchase_order_lines`, `project_todo_events`, RFQ deliveries, links and approvals, `project_rfis`, selections, warranty claims |
| Schedule and templates | `schedule_tasks`, `task_dependencies`, `schedule_task_assignees`, baselines, publications, `workday_exceptions`, project, estimate and schedule templates |
| Field | `daily_logs`, `daily_log_photos`, `daily_log_task_links`, `owner_project_updates`, `weather_*`, equipment logs |
| Documents | `project_documents`, `project_record_drive_files` / `_snapshots`, `contract_packets`, archives, vendor trade documents, `print_snapshots` |
| Messaging | `project_correspondence*`, `correspondence_*`, `email_reply_threads`, `inbound_emails`, `channels`, `messages`, `notification_*`, `activity_events` |
| Calendars | `work_calendar_*`, `my_compass_calendars*`, `compass_project_calendars*`, `google_calendar_*`, `project_client_meetings`, internal duties |
| Contacts | `customers`, `customer_contacts`, `vendors`, `vendor_contacts`, `internal_contacts`, `project_contacts`, follow-ups, interactions, notes |
| Accounting bridge | `sage_*` queues, snapshots and proposals, `sage_cost_codes`, `project_field_cost_codes` |
| Product sales | `{sales}_*` catalog, order and rental tables |
| Workspace | dashboards, themes, preferences, the values board, agent and MCP tables, plugins, the feedback desk, the listening room, social, offline sync |
| Legacy import | `buildertrend_*` staging and identity-review tables |

The diagrams follow.
