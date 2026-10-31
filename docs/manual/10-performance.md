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

**Remaining work.** Phases 4 and 5 of the performance plan are still pending. Likely candidates, not yet measured:

- move the remaining list pages to server-side paging (the shared record-list standard pages at 25/50/100);
- trim the dashboard's first-load queries.

Re-run the insights command after each change, and compare total time and rows read.

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
