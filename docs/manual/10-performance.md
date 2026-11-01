# 10. Performance and scalability

## 10.1 Current limits

Cloudflare's limits change. Check the current published values before relying on a number here. The figures below are the ones the code is designed around.

| Limit | Value the code assumes | Where it bites | How Compass handles it |
|---|---|---|---|
| D1 bound parameters per statement | 100 | `IN (...)` lists and multi-row inserts | `chunkD1Values` (50 per chunk), `chunkD1Rows`, `chunkD1InsertRows` (`src/lib/d1-query.ts`). Hand-written slicing is a ratchet violation |
| D1 statement size and complexity | Very large `UNION` or `OR` chains can exhaust the database | Bulk audits across many tables | Never build giant UNIONs. A 150-branch read once reset the production database. Batch audits as many small indexed queries |
| D1 database size | 10 GB per database (paid plan) | Long-term growth of logs, events and imported history | Large payloads (files, transcripts, PDFs) go to the shared drive or R2, not to D1 |
| D1 concurrency | One writer per database; queries run one at a time | Slow queries block everyone | Index every lookup; keep each query short; batch writes with `db.batch` |
| D1 queries per worker invocation | 1,000 on the paid plan | Loops of queries | "No queries in loops" rule; `db.batch`, `inArray`, `Promise.all` |
| Worker CPU time | 30 s by default on the paid plan (configurable) | Scheduled jobs, PDF builds, imports | Jobs set their own time budgets (for example 18 s for weather, 45 s for inbound mail) and resume on the next tick |
| Worker memory | 128 MB per isolate | Large exports, PDF assembly, big JSON | Stream file downloads; render PDFs with Browser Rendering; cap print snapshots at 1.5 million characters |
| Subrequests per invocation | 1,000 on the paid plan | Drive, mail and calendar sync fan-out | Per-run caps ("a few people per run"), cursors, refresh at most every 5 minutes per item |
| Request body | 26 MB for server actions (`next.config.ts`) | Uploads | Large files go straight to the drive through a resumable upload session (`startDrivePickerUpload`) |

## 10.2 Measured hotspots and fixes

These were found with `wrangler d1 insights` over seven days of production traffic, then fixed with additive changes:

| Hotspot | Cause | Fix |
|---|---|---|
| Project registry list read about 47,000 rows per call | Duplicate and removal checks had no index | Ten covering indexes; a planner test fails if those queries fall back to scans (#1044) |
| Schedule, chat and notification views scanned whole tables | Missing indexes on lookup columns | Same change (#1044) |
| Every request ran five sequential reads to resolve the user (about 366,000 times a week) | User, invitations, contact details, memberships and project role were read one by one | One batched round trip keyed on the identity; memberships re-read only after an invitation is claimed (#1045) |
| Feature checks read overrides two or three times per feature | Per-check queries | All of a person's role, team and personal overrides read once per request with React `cache` (#1045) |
| The registry visibility filter was copied into five files; follow-up aging re-read every project | Duplicated logic and over-reading | One `activeRegistryProject()` filter; aging reads only the jobs the caller did not already load (#1046) |
| Many browser timers polled in hidden tabs; components fetched the same data twice | Ad-hoc `setInterval` | One `useVisibleInterval` hook; shared providers for notifications and the project list; `getProjects` cached per request (#1049) |
| About 200 foreign-key columns had no index | Schema drift | `0275_fk_indexes.sql` (additive `CREATE INDEX IF NOT EXISTS`) and a CI rule that every foreign key leads an index (#1050) |
| All Projects took 4 s or more before anything rendered | Worker CPU in the duplicate detector, and non-essential panels on the critical path, not D1 | Duplicate detector profiles each project once (about 3,950 ms → 40 ms); non-essential panels stream; payload cut from about 690 KB to 140 KB (#1090, worked example below) |

**Remaining work.** Phases 4 and 5 of the performance plan are still pending. Likely candidates, not yet measured:

- move the remaining list pages to server-side paging (the shared record-list standard pages at 25/50/100);
- trim the dashboard's first-load queries.

Re-run the insights command after each change, and compare total time and rows read.

### Worked example: All Projects (measure first)

The hub page (`/dashboard/projects`) was reported slow. Before the change it awaited six loaders in one `Promise.all` and rendered nothing until all of them finished. The obvious guess was a missing index. Measuring showed otherwise.

1. **Measure D1.** `wrangler d1 insights --sort-by time` and `--sort-by reads` (read only) over production traffic. Every query the page ran was already fast: the project list read about 2,800 rows in about 7 ms, the overview statements 1–9 ms each, the duplicate identities about 5 ms.
2. **Check the plans.** `EXPLAIN QUERY PLAN` on a local replay of all migrations, never on production. Every statement used an index; the only leftover was a temporary B-tree to sort about 1,100 rows. **No index was missing, so no migration was written.**
3. **Measure the Worker.** The cost was CPU and payload, not the database:
   - `findProjectDuplicateCandidates` compared every pair of projects (about 600,000 pairs at 1,100 projects) and re-normalized both projects' text on every comparison: about 3,950 ms per run on 1,100 synthetic projects, on the critical path for owners and registry managers.
   - The page waited for the whole dashboard overview batch (10 statements, about 15,000 rows), then, for admins, about three more sequential round trips for missing daily logs.
   - It sent the entire dashboard overview to the browser (about 690 KB of JSON at 1,253 projects) although the cards read four fields and one photo, and re-sent the project list (about 420 KB) that the layout already provides.
4. **Fix what was measured.**
   - **Duplicate detector** (`src/lib/project-duplicate-detector.ts`). Each project is normalized once into a profile. Pairs that share no value stop before any allocation, because their best possible score (35) is below the threshold (60). The scan is still pairwise, but each comparison is cheap: about 3,950 ms → about 40 ms on the same input. An equivalence test compares the new detector with a frozen copy of the old one on seeded registries covering every collision type.
   - **Streaming** (`src/app/dashboard/projects/page.tsx`). The page awaits only the small queries it needs to render the list (intake assignees, the internal department name and saved views). The overview, the duplicate scan and the number-review exceptions start at once but are passed to the client as promises. Card health, next step and photo read them with React `use()` inside small `<Suspense>` boundaries, with a muted bar and the existing photo placeholder as fallbacks. Number-review flags wait for the approved exceptions, so a project is never flagged early.
   - **Slim payload** (`src/components/projects/project-hub-signals.ts`). The page sends only `progress`, `openRfiCount`, `openPoCount` and `nextTaskTitle` per project plus the first field photo (about 140 KB), and the hub reads the project list from `useProjectList()`, the request-cached list the layout already shares.
5. **Compare.** The number of D1 queries and rows read did not change (about 20,000 rows per load). Only about two small round trips now block the first render, so the estimated time to first list render fell from 4 s or more to under 200 ms after the layout. Filters, saved views, search, paging, permissions and demo rules are unchanged.

The lesson for this codebase: check `d1 insights` and the query plan before adding an index, and when the database is already fast, look at Worker CPU, sequential awaits and payload size. Keep the first render on the smallest set of queries and stream the rest.

## 10.3 Growth options

These options can be combined. Each row says when to act and what it costs.

| Option | What it is | Trigger to adopt | Trade-offs |
|---|---|---|---|
| **Per-company database sharding** | One D1 database per company, chosen per request from the active organization (bindings, or the D1 HTTP API for many databases) | A company needs physical isolation or its own data residency; any single database approaches about half its size limit; one company's load slows others | The strongest isolation, and limits apply per company. But migrations must run on every database (needs a migration runner), cross-company admin reporting needs fan-out, and the bridge pins and crons must loop over databases. The demo environment already proves the single-company deployment model |
| **Read replication** | D1 read replicas through the Sessions API (`withSession`), sending reads to nearby replicas with sequential consistency per session | Read latency for distant users, or read volume dominating insights while writes stay modest | A small code change at `getDb` (carry the session bookmark in a cookie). Some reads may be slightly stale unless they follow a bookmark. Does nothing for write contention |
| **Queues** | Cloudflare Queues for background work now driven by cron ticks (paper trail, calendars, mail sync, notifications fan-out, PDF builds) | Jobs regularly hit their time budget; backlog grows between ticks; you want per-item retries and dead-letter handling | Better retries and back-pressure, and work spreads across invocations. Adds another binding and consumer code; the order of messages is not guaranteed; idempotency keys become mandatory (most writers already have them) |
| **Caching / KV** | Workers KV or the Cache API for slow-changing reads: feature settings, permission matrices, department profiles, weather layers, help content | The same small reads dominate insights; settings reads on every request | Large cut in D1 reads. Eventual consistency (KV takes up to about 60 s to propagate), so every write path must invalidate the cache. Never cache per-user permission results without the user and organization in the key |
| **Durable Objects** | Single-threaded objects with their own storage, one per project or channel (the listening room already uses one) | Real-time collaboration (live chat without polling, schedule co-editing); strict ordering such as job-number allocation; per-project rate limiting | Strong consistency and WebSockets. Adds a second source of truth unless the object only coordinates and D1 stays the store. Each object lives in one location, so sharding by project matters |
| **Postgres through Hyperdrive** | Move the relational store to a managed Postgres, reached from Workers through Hyperdrive's connection pooling and caching | The data outgrows D1's size or single-writer model; heavy reporting, full-text search, row-level security or complex joins are needed; or an adopting company requires Postgres | Larger limits, concurrent writers, richer SQL, mature backups and replicas. But it is a migration project: Drizzle supports Postgres, yet the schema must be ported (SQLite text dates and boolean integers), raw SQL in stores reviewed, and latency depends on where the database is. One-writer-per-table domain stores make the port contained, because every write site is known (Appendix A lists them) |

**Recommended order for a growing deployment:**

1. Keep indexing and batching, guided by insights.
2. Cache settings and permissions in KV, with invalidation.
3. Move the cron fan-out jobs to Queues.
4. Turn on read replication.
5. Shard per company when the first large tenant or a residency requirement arrives.
6. Consider Postgres when sharding is no longer enough, or a reporting workload needs it.
