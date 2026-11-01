# 1. Executive overview

## 1.1 What Compass is

Compass is a construction-management system that runs in the browser, in a mobile app and in a desktop app. A building company uses it to run every job from first inquiry to warranty:

- leads and job numbers;
- estimates, contracts and change orders;
- schedules, daily logs and photos;
- to-dos, requests for quote (RFQs), purchase orders (POs) and requests for information (RFIs);
- billing and pay applications;
- documents, email and chat with owners and vendors.

It also covers the company's internal work: an office duty log, recurring duties, a company values board, dashboards and maps.

Compass is the system of record for project work. Accounting stays in a separate accounting system. Compass talks to that system through an adapter (chapter 7) instead of duplicating its ledgers.

## 1.2 Audiences

| Audience | Who | What they use |
|---|---|---|
| Office staff | Executives, project managers, estimators, project administrators, accounting, designers | The full staff workspace: every module, permission-scoped by role and feature |
| Field crews | Superintendents and crew members | Field Mode on phone and tablet: daily logs with photos, machine logs, to-dos, schedule, chat; works offline and queues uploads |
| Owners / clients | The people the company builds for | A permission-scoped owner view of their own projects: shared documents and photos, published schedule, owner updates, change orders and pay applications released to them, messages, meetings, selections |
| Vendors / subcontractors and suppliers | Trade partners | A vendor view: RFQs to price (also by a no-login price link), POs to accept, RFIs, shared documents and schedule items, trade documents |
| Online customers | Buyers of catalog products | The optional product sales / online ordering module: catalog, orders and rentals for a sales department |

## 1.3 Problems it solves

- **One record per job.** Estimates, the contract, change orders, schedule, logs, photos, correspondence and billing hang off one project record. Nothing has to be re-keyed between tools.
- **Outside parties without email chaos.** Every outside email is sent as *tracked email*: replies come back to the record they are about, notify the right staff and appear in the job's Activity.
- **Field-to-office loop.** A daily log can tick off the to-dos that were worked on, flag blockers and turn issues into new to-dos (section 6.5). Missing logs trigger reminders.
- **Money that adds up.** Estimates, contract budget revisions, change orders and pay applications are computed on the server from stored inputs. The browser is never trusted for totals. Approved pay applications are matched to accounting invoices.
- **A durable paper trail.** Each changed record is copied to the job's shared-drive folder as a PDF after a quiet period.
- **Operational awareness.** The dashboard and portfolio map show active jobs, pipelines, schedule risk, weather and wildfire warnings, and each person's plan for the day.

## 1.4 Product principles

These principles are enforced in code review and, where possible, by CI (chapter 4).

1. **Multi-company.** Every row belongs to an organization, and every query is scoped to it in SQL. Nothing is hard-coded to one company: names, departments, people, cost codes, thresholds and labels come from data and settings. A second company can be onboarded without code changes. Gaps that still exist are listed in chapter 12.
2. **Customizable by default.** Every feature's rules and thresholds can be changed per company in Settings, with sensible defaults. Settings are stored per company and feature (`organization_feature_settings`, registry in `src/lib/feature-settings/registry.ts`). Examples: reminder times, aging thresholds, the paper-trail quiet period, weather limits, the job-number format, department on/off switches and the values board.
3. **People decide when work is done.** Compass suggests, reminds and links, but it does not close work on its own:
   - a "finished" workflow item, a to-do or a job status is changed by a person;
   - automation may move an item to *started* or *in progress* (for example, a daily log that worked on a to-do), never to *complete*;
   - estimate and contract acceptance do not change the job status by themselves.
4. **Permission-scoped workspaces.** Each person sees a workspace shaped by their role, their feature permissions and their project memberships:
   - staff see their company's projects;
   - owners see only records released to the owner audience;
   - vendors see only records released to the vendor audience, or to them personally;
   - staff can *preview* exactly what an owner or vendor sees, and writes are blocked while previewing.
5. **The server owns rules and math.** Allowed actions (approve, send, edit, delete) come from the server as flags, not from status strings in components.
6. **Every create has a delete.** A feature that lets a user create and edit a record also provides a permission-appropriate delete or void, with confirmation and an audit trail.

## 1.5 System at a glance

![Compass system context](diagrams/system-context.png)

| Layer | Technology |
|---|---|
| Web application | Next.js 15 App Router and React 19, TypeScript (strict), shadcn/ui on Tailwind CSS v4 |
| Hosting | Cloudflare Workers through the OpenNext adapter (`@opennextjs/cloudflare`) |
| Database | Cloudflare D1 (SQLite) through Drizzle ORM; 318 tables; migrations in `drizzle/` |
| Files | The company's shared drive (Google Drive adapter); private R2 bucket for help videos |
| Identity | WorkOS adapter (hosted sign-in, SSO, invitations) |
| Background work | Two Cloudflare cron triggers fan out to 16 jobs (Appendix C) |
| Real time | A Durable Object for the shared listening room; RealtimeKit for video calls; polling for everything else |
| Mobile | Capacitor shell (iOS and Android) with an offline field outbox |
| Desktop | Electron shell |
| AI | An in-app assistant with tool calling over MCP, provider-pluggable |
| Accounting | An on-premises bridge agent that polls Compass over signed HTTPS (adapter for a desktop construction-accounting system) |

## 1.6 Size of the system (at this edition)

| Measure | Count |
|---|---|
| Database tables | 314 |
| Server action files / exported actions | 198 / 822 (Appendix B) |
| API route handlers | 130 |
| Domain modules (`src/lib/domain/*`) | 33 |
| Scheduled jobs | 16, on two cron triggers |
| Feature permissions | about 43 |
| Per-company feature-settings groups | 33 |
