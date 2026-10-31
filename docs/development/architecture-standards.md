# Architecture and Data Standard

Compass grows by adding features to a shared core. This standard keeps every
addition inside the same limits, so the system stays fast, correct, and
understandable as it grows. It applies to new code immediately. Existing code
that predates it is recorded in a baseline and brought into line over time.

Automated checks enforce the parts that can be tested:

| Check | What it guards |
|-------|----------------|
| `src/lib/__tests__/architecture-standard.test.ts` | code ownership, shared helpers, layering, file size, type escapes (`as`, `!`, `any`) |
| `src/db/__tests__/schema-integrity-standard.test.ts` | schema, foreign keys, indexes, migration drift |
| `src/components/__tests__/polling-standard.test.ts` | network polling |
| `bun run knip` (CI) | unused files and exports |

The rest is reviewed with the PR. When a check fails, fix the code to follow
this document. Do not grow an allowlist or baseline to make it pass. Every
exception needs a written reason next to it.

## How the ratchet works

Existing violations are frozen in
`src/lib/__tests__/architecture-baseline.json`. A check fails if:

- a new file or table appears that breaks a rule, or
- a baselined count grows, or
- a baselined count shrinks without the baseline being updated. This locks in
  each improvement, so cleaned-up code cannot regress.

Regenerate the baseline after you reduce a violation:

```bash
bun scripts/architecture-baseline.mjs --write
```

Review the diff. A regenerated baseline must only remove entries or lower
counts.

## 1. Domain modules own their data

Each kind of record belongs to one domain module under `src/lib/domain/<module>/`:

| File | Owns |
|------|------|
| `access.ts` | resolving who may see or change the record, built on the shared action context |
| `store.ts` | every insert, update, and delete for the module's tables |
| `rules.ts` | pure business logic such as numbering, status transitions, totals, and validation. It has no database or network access. |

Server actions (`src/app/actions/`) and API routes (`src/app/api/`) are thin
adapters. They parse input, call the domain module, revalidate paths, and
return the action result. Integrations (Sage, Google, Buildertrend, Foxit,
Square) call domain stores and never write tables directly.

Rules:

- **One writer per table.** Only the owning module's `store.ts` writes a table,
  whether through Drizzle or raw SQL (`INSERT INTO`, `UPDATE`, `DELETE FROM`).
  The check keeps a list of the files that currently write each table, and new
  writers fail it.
- **`src/lib` never imports from `src/app`.** Shared logic moves down into
  `src/lib`, and actions and routes import it.
- **Server actions do not import other server action files** for logic. Both
  call the domain module.

Modules: `project` (projects, numbering, visibility, families, job status,
members, project audit), `access`, `estimates` (estimates, lines, assemblies,
phases, acceptance, change orders), `operations` (to-dos, purchase orders,
RFQs, Sage queue), `schedule`, `contacts` (project contacts, customers,
vendors, directories), `field` (daily logs, photos, owner updates, weather),
`documents` (Drive, folders, sharing), `messaging` (notifications, tracked
email, conversations).

## 2. One action context

Every server action and API route starts from the shared action context. It
resolves the user, the organization, the database, feature permissions, and
demo read-only access in one place, and it returns the project record when
the action is about a project. It lives in `src/lib/server/action-context.ts`.
Until an area moves to it, the `handRolledContext` ratchet stops that area's
existing direct calls from growing. Do not hand-roll
`getCloudflareContext` + `getDb` + `getCurrentUser` + role checks in an action
file, and do not write another local `verifyProjectAccess`.

## 3. Relational integrity

The database is the source of truth, and each fact is stored once.

- **Reference rows, don't copy them.** Point to a person, company, contact,
  vendor, customer, or project by its id with a foreign key. Do not copy its
  name, email, phone, or address onto another row. Read it through a join or
  a view.
- **Snapshots are the exception, and they are named.** A value that must stay
  as it was when a document was signed, sent, or approved is a snapshot. Its
  column name ends in `_snapshot` or it carries a `// snapshot:` comment that
  says what it freezes.
- **Every internal id is a foreign key.** A `*_id` or `*_by` column that points
  at a Compass row uses `.references()`. Ids from outside systems (Google, Sage,
  Buildertrend, Foxit, Square, WorkOS, email providers) are exempt by prefix. A
  reference that deliberately survives deletion carries an `// fk-exempt:`
  comment with the reason.
- **Every foreign key is indexed.** The referencing column leads some index.
- **Link tables are unique on their pair.** A membership or link row (two
  foreign keys, plus a role or timestamps) has a unique index on the pair.
  Imported rows are unique on `(source_system, source_*_id)`, so an import can
  never create the same record twice.
- **Lists of records are rows, not JSON.** Do not store an array of ids or a
  list of child records in a text column. Use a child table. JSON columns are
  for raw provider payloads and named snapshots only, and they carry a
  `// json:` comment saying which.
- **Status and type values come from one list.** Each status, type, kind, or
  role column uses `enum:` from an exported `as const` array that the code
  shares. Values are lowercase, and the same concept has one spelling
  (`canceled`, `completed`).
- **One concept, one table.** Before adding a table, check whether the concept
  already has a home (calendars, reply threads, saved views, event history,
  external-system links). Extend it instead of creating a parallel store.
- **Polymorphic references are a last resort.** A `*_type` + `*_id` pair names
  its allowed types in a shared constant, and a trigger or per-type
  foreign-key column checks the target exists.
- **Every query is scoped.** A read of a table that holds several companies'
  data filters by organization or project in SQL. Never read a whole table and
  filter it in JavaScript.

### Migrations

- **Additive only.** D1 cannot safely rebuild a table: dropping and recreating a
  parent table wipes its children or leaves foreign keys off. Add tables,
  columns, indexes, views, and validation triggers. Never drop or recreate a
  table in production.
- **A constraint an existing column lacks** (a foreign key or CHECK) is added
  with a validation trigger, following migrations 0108 and 0144, or with a new
  foreign-key column plus a backfill.
- **The schema files are the source of truth.** Every table, column, and index
  in a migration is also declared in `src/db/schema*.ts`, and every schema file
  is listed in `drizzle.config.ts`. CI replays every migration and compares the
  result with the schema files.
- **Data changes are separate and approved.** A migration that changes or
  deletes existing rows, such as removing duplicates before adding a unique
  index, needs explicit approval and its own PR.

## 4. Shared helpers, never local copies

Use the shared modules for these jobs, and never define a local version:

| Job | Use |
|-----|-----|
| money | `src/lib/format.ts` (`formatCents`, `formatDollars`). Amounts are stored and passed as integer cents. |
| dates | `src/lib/format.ts` (`parseDateOnly`, `formatDateOnly`). A date-only value never goes through `new Date("YYYY-MM-DD")`. |
| type guards | `src/lib/shared/guards.ts` (`isRecord`, text and number readers) |
| environment values | `src/lib/shared/env.ts`. Never `env as unknown as Record<string, string>`. |
| D1 parameter limits | `chunkD1Values` / `chunkD1Rows`. Never a hand-written `slice(i, i + n)` loop. |
| action results | the shared `ActionResult<T>` type |
| database handle type | the shared `Db` type |

## 5. The server owns rules and math

- Stored totals, tax, markup, fees, and amounts are computed on the server from
  the stored inputs. The browser may show a preview using the same pure
  function from `src/lib`, but the server recomputes before saving and never
  trusts a total sent by the client.
- Which actions a user may take on a record (approve, send, edit, delete)
  comes from the server as flags on the record. Components do not re-derive
  it from status strings.

## 6. Efficient by default

- **No queries inside loops.** Batch with `db.batch`, `inArray`, or
  `Promise.all`. A loop is allowed only for rate-limited outside APIs, with a
  comment saying so.
- **One read per fact per request.** Request-scoped getters, such as the
  current user, the project list, and permission overrides, are wrapped in
  React `cache()`. Components read data the layout already loaded from its
  provider instead of fetching it again.
- **Load data on the server.** Pages fetch on the server and pass props.
  `page.tsx` files are server components. Client components call server
  actions for user actions, not to load the page.
- **Polling goes through `useVisibleInterval`.** It pauses in hidden tabs. Two
  components that need the same live data share one provider and one timer.
- **Heavy libraries load lazily.** Maps, charts, PDF, rich text, and video load
  with `next/dynamic` or `import()` where they are used.

## 7. Size limits

- No new file over 800 lines in `src/app`, `src/lib`, or `src/components`. A
  file already over the limit may not grow.
- No new function over 300 lines. Split by responsibility.
- No unused files or exports. Delete them; git keeps the history.

## Type safety

The TypeScript conventions in `conventions.md` are ratcheted. The parser,
not a text search, counts each file's `x as T` assertions (`as const` is fine),
non-null `!` assertions, and `any`. Existing counts may only fall. Narrow with a
type guard (`src/lib/shared/guards.ts`) or fix the types instead.

## 8. Built for any company

- Nothing is hard-coded to one company. Company names, departments, people,
  cost codes, and thresholds come from data and settings.
- Every feature's rules and thresholds can be changed per company in Settings,
  with sensible defaults.

## Reviewing a PR against this standard

- [ ] New tables and columns: foreign keys, indexes, a unique index for link or
      imported rows, enums from shared lists, no copied fields, no id lists in
      JSON.
- [ ] Writes go through the owning domain store, and reads are scoped in SQL.
- [ ] The action starts from the shared action context.
- [ ] No local money, date, guard, or env helpers.
- [ ] Totals and allowed actions are computed on the server.
- [ ] No queries in loops, no duplicate fetches, polling through
      `useVisibleInterval`.
- [ ] Files and functions stay within the size limits.
- [ ] Nothing is specific to one company, and the rules are customizable per
      company.
