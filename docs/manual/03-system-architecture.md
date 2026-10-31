# 3. System architecture

## 3.1 Runtime overview

Compass is one Next.js 15 (App Router, React 19) application. The OpenNext adapter (`@opennextjs/cloudflare`, `open-next.config.ts`) builds it into a single Cloudflare Worker. A thin custom entry point, `custom-worker.ts`, wraps the generated worker to add three things:

- a `scheduled()` handler for the cron triggers;
- a WebSocket route for the listening-room Durable Object;
- the Durable Object class export.

Everything else, including pages, server actions and API routes, is served by the OpenNext worker.

![System context](diagrams/system-context.png)

| Concern | Where |
|---|---|
| Worker entry | `custom-worker.ts` (imports `.open-next/worker.js`) |
| Worker configuration | `wrangler.jsonc`: `main`, `compatibility_flags: nodejs_compat, global_fetch_strictly_public`, routes, crons, bindings, required secret names, `vars`, and an `env.demo` block |
| Next.js configuration | `next.config.ts`: `deploymentId` for version-skew detection, `serverActions.bodySizeLimit: 26mb`, router `staleTimes`, `optimizePackageImports` |
| Database handle | `src/db/index.ts` `getDb(env.DB)` returns a Drizzle D1 client over every schema module |
| Cloudflare context | `src/lib/db.ts` `getCloudflareContext()`. In local development and E2E it returns a local SQLite-backed context (`better-sqlite3`); in production it uses OpenNext's context |
| Middleware | `src/middleware.ts` |

## 3.2 Bindings

Bindings are declared in `wrangler.jsonc`, and Appendix C lists them by name. There are eight:

- **`DB` (D1).** The single relational store, with migrations in `drizzle/`. The demo environment binds its own database.
- **`HELP_VIDEOS` (R2).** Private help tutorial videos.
- **`ASSETS`.** Static assets built by OpenNext.
- **`IMAGES`.** Image transformations.
- **`BROWSER` (Browser Rendering).** Headless Chromium for server-side PDF rendering (paper-trail copies, print).
- **`AI` (Workers AI).** On-platform models, such as speech-to-text for voice input.
- **`WORKER_SELF_REFERENCE` (service binding to itself).** Scheduled jobs call the worker's own API routes through it, so jobs run through the normal request path, including authentication and logging.
- **`LISTENING_ROOM_COORDINATOR` (Durable Object, SQLite-backed class `ListeningRoomCoordinator`).** One object per room. It keeps a playback sequence number and fans messages out over WebSockets (`src/cloudflare/listening-room-coordinator.ts`).

Files live in the company's shared drive, not in R2 (section 7.3). Compass stores drive file ids and its own sharing flags.

## 3.3 Request lifecycle

Most interactions are server actions: functions in `src/app/actions/*.ts` marked `"use server"` and called directly from client components. Pages are server components that load their data on the server and pass it down as props.

![Request lifecycle: browser to server action to context and permission to domain store to D1](diagrams/request-lifecycle.png)

1. **Middleware** (`src/middleware.ts`):
   - removes any caller-supplied audience header and derives the audience from the URL;
   - rejects non-GET API calls while staff are previewing an owner or vendor view;
   - runs the identity provider's session check;
   - lets public paths through (`src/lib/public-paths.ts`) and redirects everyone else to `/login`.

   Routes that write the session (`/callback`, mobile session exchange) skip the session check, so a stale cookie cannot overwrite a fresh one.
2. **The server action** parses its input, usually with zod.
3. **The action context** (`src/lib/server/action-context.ts`) resolves everything the action needs in one place: the user (`getCurrentUser`, one batched D1 read, cached per request), the active organization, the database, the feature permission (`canFeature`), demo read-only status and, for project actions, the project record. Project access has two scopes: `organization` (the project belongs to the active company) and `member` (`getProjectAccessRecord`: staff with organization scope, project members including owners and vendors, and invited previews).
4. **The domain module** carries out the operation. Pure rules (`rules.ts`) compute totals, numbers and allowed transitions. The store (`store.ts`) writes, usually as one `db.batch([...])` that includes the audit or activity rows.
5. The action revalidates the affected paths and returns `{ success: true, data }` or `{ success: false, error }`. It never throws to the browser for expected failures.

API routes (`src/app/api/**/route.ts`) follow the same shape. They serve webhooks, scheduled jobs, file streaming, the native shells, the assistant and the accounting bridge.

## 3.4 Authentication

Sign-in is delegated to a hosted identity provider. The current adapter is WorkOS AuthKit (`@workos-inc/authkit-nextjs`):

- `src/app/callback/route.ts` completes the PKCE flow, calls `ensureUserExists`, and refuses a code without state;
- password, magic-link, SSO, sign-up and mobile session exchange are handled under `src/app/api/auth/*`;
- the session is an encrypted cookie (`WORKOS_COOKIE_PASSWORD`, lifetime `WORKOS_COOKIE_MAX_AGE`).

`getCurrentUser()` (`src/lib/auth.ts`) does the following:

- maps the identity to a `users` row;
- claims pending invitations by email;
- reads the person's organization memberships and picks the active organization (cookie `compass-active-org`, limited to the person's own memberships);
- derives the effective role.

The rest of the application depends only on the `AuthUser` type and on `getCurrentUser` / `requireAuth`, which is what makes the provider replaceable (section 7.6).

## 3.5 Scheduled jobs

`wrangler.jsonc` declares two cron triggers, `* * * * *` and `*/10 * * * *`. `custom-worker.ts` `scheduled()` fans each tick out to independent jobs with `Promise.all` inside `ctx.waitUntil`:

- each job is a signed POST to an `/api/operations/*` route (or `/api/email/gmail-sync`) through `WORKER_SELF_REFERENCE`;
- a job's failure is logged by error class and status only, and never stops the others;
- there is no retry inside a run, because the next tick is the retry;
- jobs budget their own time (for example, the weather refresh stops at 18 seconds) and keep their own cursors ("refreshed at most every 5 minutes per person").

| Every minute | Every 10 minutes |
|---|---|
| Invitation email recovery | Feedback-desk reconciliation |
| Inbound tracked-email sync | SMS message-body recovery |
| Card-payment receipt reconciliation | Accounting-bridge health |
| Payments-credential health | Message-desk stale reminders |
| Paper-trail Drive copies | Project follow-up overdue reminders |
| Personal calendars | Missing daily-log reminders |
| Project calendars | Meeting-transcript capture |
| | Today's plan and overload warnings |
| | Weather and wildfire refresh |

Appendix C maps each job to its route. Section 9.3 explains how to check that each job is still writing.

## 3.6 Real time

Most live data is polled through one hook, `useVisibleInterval` (`src/hooks/`). It pauses in hidden tabs, refreshes once when the tab is shown again, and lets components that need the same data share one provider and one timer (for example, `NotificationCenterProvider`). CI enforces this (`src/components/__tests__/polling-standard.test.ts`).

Two features need lower latency:

- **The listening room** uses a WebSocket to the Durable Object. The worker authorizes the socket first, by calling `/api/listening-room/sync-authorize` with the user's cookies.
- **Video calls** use Cloudflare RealtimeKit through a proxy route (`/api/realtimekit/[...path]`).

## 3.7 Mobile shell

The mobile app is a Capacitor shell (`capacitor.config.ts`, `ios/`, `android/`) with two modes:

- **Bundled field shell** (the default). A small offline-first app in `mobile-shell-src/`, built into `mobile-shell/` by `bun run mobile:build`. It signs in with PKCE and calls the field APIs (`src/app/api/field/*`: native bootstrap, projects, daily logs, machine log, conversations, notifications). Work done offline waits in a device outbox, and photos wait on the device filesystem. Both are replayed when the device is back online.
- **Live wrapper** (`COMPASS_MOBILE_MODE=live`). It loads the hosted app in the WebView.

Web code reaches native APIs only through dynamic imports behind `isNative()` (`src/lib/native/platform.ts`), so native code can never break the web build.

Push notifications use FCM HTTP v1 and APNs provider tokens (`src/lib/push/providers.ts`). Devices register at `/api/push/register`.

## 3.8 Desktop shell

The Electron app (`electron/main.ts`, `electron/preload.ts`, `electron-builder.yml`) loads the hosted app with context isolation on and node integration off. Its preload bridge, `window.compassDesktop`, exposes window state, zoom, global shortcuts, open-external and auto-update. The `desktop-release.yml` workflow builds Linux, macOS (universal) and Windows packages on version tags.

## 3.9 Environments

| Environment | Worker | Database | Scheduled jobs | Integrations |
|---|---|---|---|---|
| Production | `compass` on the company's configured domain | `compass-db` | both crons | all that are configured |
| Demo | `compass-demo` (`--env demo`) on a separate domain | `compass-demo-db` | none | none; identity uses the provider's staging environment; seeded with Summit Ridge Builders (`scripts/demo/`) |
| Local development | `bun dev` (Turbopack) | local SQLite file (`bun run db:init-local`) | none | whatever `.dev.vars` / `.env.local` provide |
| CI / E2E | Next build plus Playwright | `.e2e/compass.db` seeded by `scripts/seed-e2e-local.mjs` | none | none |

## 3.10 Repository layout

| Path | Contents |
|---|---|
| `src/app/` | Routes (`dashboard/`, `(auth)/`, `print/`, public token pages `quote/`, `ecard/`, `vendor-docs/`), `actions/` (server actions) and `api/` (route handlers) |
| `src/lib/domain/<module>/` | Domain modules: `store.ts`, `rules.ts`, `access.ts` |
| `src/lib/` | Shared logic: integrations (`google/`, `sage/`, `foxit/`, `goto/`, `push/`, `email/`), `server/action-context.ts`, `permissions.ts`, `permission-enforcement.ts`, `format.ts`, `shared/` |
| `src/db/` | Drizzle schema files `schema*.ts` and the `getDb` handle |
| `src/components/` | React components, with shadcn/ui primitives in `ui/` |
| `src/hooks/`, `src/contexts/` | Client hooks and providers |
| `src/cloudflare/` | Durable Object classes |
| `packages/agent-core`, `packages/compass-bridge` | The assistant runtime and tools, and the local bridge daemon |
| `drizzle/` | SQL migrations `NNNN_name.sql` |
| `scripts/` | Build helpers, generators, import builders, accounting-bridge agents (Python, C#, PowerShell) |
| `deploy/systemd`, `ops/systemd` | Service and timer units for the on-premises bridge host |
| `electron/`, `mobile-shell-src/`, `ios/`, `android/` | Shells |
| `e2e/`, `__tests__/`, `**/__tests__/` | Playwright and Vitest tests |
| `docs/` | Architecture, development standards, modules, help guides and this manual |
