# 11. Rebuilding Compass

This chapter is for a team that has to rebuild Compass, whether on the same stack or a different one. It sets out what to build first, which modules are core and which are optional, and the design decisions worth keeping.

## 11.1 Core and optional modules

| Tier | Modules | Why |
|---|---|---|
| **Core platform** | Identity and organizations, roles and feature permissions, the action context, domain-module scaffolding, per-company feature settings, activity and audit, notifications, file references (drive adapter), print preview | Everything else depends on them |
| **Core construction** | Projects and numbering, job status, contacts directory, estimates and contract budget, change orders, schedule, daily logs and photos, to-dos, RFQs, POs, RFIs, pay applications, documents, tracked email, owner and vendor audiences | The product's reason to exist |
| **Recommended** | Paper trail, project families and linked jobs, contract packets and e-sign, deposits, selections, warranty, dashboard and portfolio map, today's plan, help | High value; each builds on the core without changing it |
| **Optional adapters** | Accounting bridge, card payments, SMS, calendars and meetings, weather and fire, push, AI assistant, social publishing, video, listening room, values board and greeting cards, product sales / online ordering, legacy import, legacy ERP | Each can be left out without breaking the rest; most are switched by settings or environment variables |

## 11.2 Build order

1. **Platform skeleton.** Next.js App Router on Workers (OpenNext), D1 with Drizzle, `getDb`, the local SQLite context for development, CI with lint, build and Vitest.
2. **Identity and tenancy.** The identity adapter, `users`, `organizations`, `organization_members`, `getCurrentUser`, the active-organization cookie, roles and the permission matrix, then the action context (`userContext`, `orgContext`, `projectContext`).
3. **Standards and ratchets.** Do this before building features. The architecture metrics script and baseline, the schema-integrity test (foreign keys, indexes, migration replay), shared helpers (money in cents, date-only values, guards, env, D1 chunking) and the UI standards check. Adding them later is far more expensive (chapter 12 shows the debt).
4. **Settings and permissions.** The feature-settings registry with zod schemas and defaults, plus feature permissions with role, team and user overrides.
5. **Projects.** Projects, numbering (reservations, retirements, aliases), job status, members, invitations, audiences, saved views and the project workspace shell.
6. **Contacts.** Customers, vendors, internal contacts and project contacts.
7. **Files and print.** The drive adapter and picker, project folder provisioning, document publishing with audience flags, and Print Preview with server-side PDF rendering.
8. **Messaging foundation.** Notifications (in-app, email, push) and tracked email with inbound reply sync. Every later outside-facing module depends on it.
9. **Estimating and contract.** Estimates (lines, assemblies, pure money rules), acceptance, contract budget revisions, then change orders with their transition table.
10. **Field.** Schedule (CPM, workdays, publication), daily logs with photos and follow-ups, to-dos, and the offline-first mobile shell.
11. **Procurement.** RFQs with price links and bids, purchase orders, RFIs.
12. **Billing.** Pay applications (G702/G703), deposits, invoices and payments.
13. **Operations.** Scheduled jobs (signed self-calls), reminders, the paper trail, dashboard and map, today's plan.
14. **Adapters.** Accounting bridge, e-sign, payments, calendars and meetings, weather, AI assistant, then the remaining optional modules.
15. **Import.** A staging-based import from the legacy system, run last, once the target model is stable.

## 11.3 Key design decisions and their rationale

| Decision | Rationale | Keep or change on rebuild |
|---|---|---|
| **Edge-hosted single worker with D1** | One deployable unit, global low latency, no servers to run, low cost at small and medium scale | Keep for small and medium companies. Plan the sharding or Postgres path from chapter 10 for large tenants |
| **Server actions for all mutations; pages are server components** | Type-safe calls without a hand-written API; data loads on the server; the client never computes totals | Keep. Expose REST routes only for webhooks, agents and native shells |
| **Domain modules with one writer per table** | Every write to a table is in one file, so invariants (numbering, totals, audit rows, paper-trail marks) cannot be skipped and every write site is known | Keep. Enforce it from day one |
| **Pure `rules.ts` shared by browser and server** | Instant previews in the browser with the same math the server re-runs before saving | Keep |
| **Integer cents and date-only strings** | No floating-point drift; no timezone shifts on dates without times | Keep. Finish converting the legacy `real` dollar columns in AR, AP and pay applications |
| **Additive-only migrations** | D1 cannot safely rebuild tables. Additive changes also make rollbacks and drift survivable | Keep, even on Postgres; it is good practice anywhere |
| **Settings, not code, for company rules** | One codebase serves many companies; rules can change without a deployment | Keep. Remove the remaining hard-coded values (chapter 12) |
| **Files stay in the company's drive** | Companies keep ownership of their documents; Compass stores references and its own sharing flags | Keep the adapter boundary so another file store can be plugged in |
| **Tracked email, with replies back to the record** | Outside parties use ordinary email, and nothing is lost in personal inboxes | Keep. It is the backbone of owner and vendor collaboration |
| **Accounting bridge by outbound polling** | Desktop accounting systems sit behind company firewalls; polling needs no inbound ports; every write needs two switches turned on | Keep the claim/result protocol. Cloud accounting systems can be called directly behind the same queue |
| **Cron fan-out to signed self-calls** | Jobs reuse the request path, logging and auth; one failing job never blocks another | Keep for simplicity. Move high-volume jobs to Queues when needed |
| **People decide when work is done** | Automation that closes work wrongly erodes trust faster than a reminder annoys | Keep as a product rule |
| **Polling over WebSockets, except where latency matters** | Simpler, cache-friendly, works through every proxy; visible-tab polling keeps the cost low | Revisit for chat if real-time demand grows (Durable Objects) |
| **Bundled offline field shell** | Field crews work without signal; uploads must survive app restarts | Keep the outbox and idempotent submission ids |
| **Ratchets instead of big-bang rewrites** | Existing violations are frozen and can only shrink; new code meets the standard immediately | Keep |
