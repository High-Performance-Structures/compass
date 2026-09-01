Getting Started
===

This guide walks you through setting up Compass for local development. By the end you'll have the dev server running, a local D1 database with migrations applied, and a clear picture of every environment variable the app needs.


Prerequisites
---

You need these installed before anything else:

- **Bun** (v1.1+) - the package manager and runtime. Compass uses Bun exclusively; don't mix in npm or pnpm.
- **Wrangler CLI** (v4+) - Cloudflare's CLI for D1 databases, secrets management, and deployment. Installed as a dev dependency, but having it globally helps for ad-hoc commands.
- **Node.js** (v20+) - needed by Next.js and some tooling even though Bun handles package management.

For mobile development (optional):
- **Xcode** (macOS only) - for iOS builds via Capacitor
- **Android Studio** - for Android builds via Capacitor


Clone and install
---

```bash
git clone git@github.com:High-Performance-Structures/compass.git
cd compass
bun install
```

That's it. Bun resolves everything from `bun.lockb`.


Environment variables
---

Copy `.env.example` to `.dev.vars` for local development:

```bash
cp .env.example .dev.vars
```

Wrangler reads `.dev.vars` automatically when running the local dev server. For production, set these as Cloudflare secrets via `wrangler secret put <KEY>`.

### Required

| Variable | Description |
|----------|-------------|
| `WORKOS_API_KEY` | API key from your WorkOS dashboard. Powers all authentication. |
| `WORKOS_CLIENT_ID` | Client ID from WorkOS. Paired with the API key. |
| `WORKOS_COOKIE_PASSWORD` | At least 32 characters. Encrypts the session cookie. Generate with `openssl rand -base64 24`. |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | OAuth callback URL. Use `http://localhost:3000/callback` locally. |

### AI agent

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | API key from OpenRouter. The AI agent routes through OpenRouter to access the kimi-k2.5 model. Without this, the chat agent won't function. |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Required to connect social accounts; encrypts OAuth tokens and signs short-lived approved-photo URLs. |
| `SOCIAL_PUBLIC_BASE_URL` | Public Compass origin used by Meta/X callbacks and Instagram media fetches. |
| `META_APP_ID`, `META_APP_SECRET` | Meta Business app credentials for Facebook Page and professional Instagram publishing. |
| `META_GRAPH_API_VERSION` | Optional Meta Graph API version; social publishing defaults to `v25.0`. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X OAuth 2.0 app credentials. The secret is optional for a public PKCE client. |
| `SOCIAL_AI_MODEL` | Optional OpenRouter vision model used for photo-aware social copy suggestions. |

### Sage integration (HPS active path, optional)

Sage 100 Contractor is the active HPS accounting, job cost, purchase order,
estimate, progress billing, and scheduling integration target. Local developers
usually do not need Sage credentials unless they are working directly on the
server-side Sage bridge.

Production Sage values must be stored as Cloudflare secrets, not committed to
the repository.

| Variable | Description |
|----------|-------------|
| `SAGE_BRIDGE_SECRET` | HMAC secret shared by Compass and the private tailnet Sage poller. Generate at least 32 random bytes. |
| `SAGE_SQL_SERVER` | Sage SQL Server host or private network name. |
| `SAGE_SQL_DATABASE` | Sage company database name. |
| `SAGE_SQL_USER` | Least-privilege Sage/SQL integration user. |
| `SAGE_SQL_PASSWORD` | Integration user password. |
| `SAGE_SQL_PORT` | Optional SQL Server port. |
| `SAGE_SQL_INSTANCE` | Optional named SQL Server instance. |
| `SAGE_SQL_ENCRYPT` | Optional SQL encryption flag, depending on certificate setup. |
| `SAGE_READ_ONLY` | Defaults to read-only unless explicitly disabled for approved write workflows. |
| `SAGE_ALLOW_CLIENT_PROJECT_WRITES` | Must be exactly `true` to enable the limited client/job creation capability. |
| `SAGE_CLIENT_PROJECT_WRITE_URL` | HTTPS endpoint for the private Sage API bridge's idempotent client/job operation. |
| `SAGE_CLIENT_PROJECT_WRITE_TOKEN` | Bearer token dedicated to the private client/job write endpoint. Store as a secret; do not reuse `SAGE_BRIDGE_SECRET`, which authenticates inbound poller requests. |
| `SAGE_COMPANY_ID` | Bridge-owned identifier for the target Sage company. |
| `SAGE_DEFAULT_CLIENT_STATUS` | Existing Sage client status used for new clients. |
| `SAGE_DEFAULT_JOB_STATUS` | Existing Sage job status used for new jobs. |
| `SAGE_DEFAULT_JOB_TYPE` | Existing Sage job type used for new jobs. |

See `docs/wip/sage-api-bridge-2026-05-14.md` and
`docs/wip/compass-security-plan-2026-05-19.md` before adding or enabling Sage
write behavior.

### Foxit eSign (optional)

Estimate signature preparation uses Cloudflare Browser Run to create the exact
client PDF and Foxit eSign to prepare and send a multi-signer envelope.
Compass adds a required Foxit `initial` field for every party on every page
except the dedicated full-signature page; the values are supplied by the
signers in Foxit, not prefilled by Compass.
Configure these values as Cloudflare secrets, never plaintext variables.

| Variable | Description |
|----------|-------------|
| `FOXIT_ESIGN_CLIENT_ID` | Client ID for the Foxit API application with eSign activated. |
| `FOXIT_ESIGN_CLIENT_SECRET` | Client secret for the same Foxit API application. |
| `FOXIT_ESIGN_WEBHOOK_SECRET` | Random secret used to verify Foxit webhook HMAC signatures. |

Register Foxit webhook events at
`/api/integrations/foxit/webhook`, including `folder_sent`,
`folder_cancelled`, and `folder_executed`. Configure Foxit to
append its Base64 HMAC-SHA256 value in the `signature` query parameter. The
Worker also requires the Cloudflare Browser Run binding named `BROWSER`.

The limited write remains disabled unless both `SAGE_READ_ONLY=false` and
`SAGE_ALLOW_CLIENT_PROJECT_WRITES=true`. The bridge endpoint must use the Sage
100 Contractor API on the private Sage host; Compass does not issue direct SQL
inserts. Apply D1 migrations `0066_sage_client_project_writes.sql` and
`0067_sage_client_project_write_approvals.sql` before enabling the capability.
Only active users with an approved Compass Sage-write record can execute this
limited write. Organization admins can grant or revoke that approval from the
user Access panel.

### NetSuite integration (legacy/generic, optional)

Only needed if working on the legacy/generic NetSuite module. HPS production
work should use the Sage integration path unless a separate architecture
decision reactivates NetSuite for a specific workflow.

| Variable | Description |
|----------|-------------|
| `NETSUITE_ACCOUNT_ID` | Your NetSuite account identifier. |
| `NETSUITE_CLIENT_ID` | OAuth 2.0 client ID from NetSuite. |
| `NETSUITE_CLIENT_SECRET` | OAuth 2.0 client secret. |
| `NETSUITE_REDIRECT_URI` | OAuth callback. Use `http://localhost:3000/api/netsuite/callback` locally. |
| `NETSUITE_TOKEN_ENCRYPTION_KEY` | AES-GCM encryption key for storing tokens at rest. Generate with `openssl rand -hex 32`. |
| `NETSUITE_CONCURRENCY_LIMIT` | Max concurrent API requests. Defaults to 15 (NetSuite's shared limit). |

### Google Drive integration (optional)

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY` | Encrypts stored service account credentials. Generate with `openssl rand -hex 32`. |

### CHERISH physical cards (optional)

Handwrytten configuration is required only to enable the Executive Admin
physical-card action. Store `HANDWRYTTEN_API_KEY` as a Worker secret. Configure
the sender name and complete US return address with the
`HANDWRYTTEN_SENDER_*` variables shown in `.env.example`. See
[greeting cards](../modules/cherish-cards.md) for the fulfillment safeguards and
the planned CardSnacks digital e-card path.

### Push notifications (optional, mobile)

| Variable | Description |
|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service-account JSON for Android FCM HTTP v1 delivery. Store as a Cloudflare secret. |
| `APNS_KEY_ID` | Apple Push Notification service key identifier. |
| `APNS_TEAM_ID` | Apple Developer team identifier. |
| `APNS_PRIVATE_KEY` | APNs `.p8` private-key contents. Store as a Cloudflare secret. |
| `APNS_BUNDLE_ID` | Optional APNs topic override; defaults to `com.hpscolorado.compass`. |
| `APNS_ENVIRONMENT` | Optional APNs endpoint selection; defaults to `production`. |

### GitHub deployment (optional)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub repo token for automatic deployments. |
| `GITHUB_REPO` | Repository in `owner/repo` format. Default: `High-Performance-Structures/compass`. |
| `GITHUB_FEEDBACK_PROJECT_ID` | GitHub Project node ID for `Compass Development & Feedback`; used to add sanitized Feedback Desk issues to the project. |

### Jarvis / Signet feedback bridge (optional)

| Variable | Description |
|----------|-------------|
| `JARVIS_BRIDGE_SECRET` | Shared HMAC-SHA256 secret used to authenticate bridge requests. Generate with `openssl rand -hex 32` and store it as a secret on both sides. |
| `JARVIS_BRIDGE_SECONDARY_SECRET` | Optional, temporary rollover secret accepted alongside the primary. Provision only for an approved operator rollover and remove it when that work is complete. |
| `JARVIS_BRIDGE_ORGANIZATION_ID` | Compass organization that receives inbound Telegram and Jarvis mailbox feedback. |
| `JARVIS_AGENT_BRIDGE_ENABLED` | Set to `true` to route authenticated Ask Jarvis chat through the private Signet/Hermes bridge. |
| `JARVIS_SERVICE_USER_ID` | Active Compass service user used for Jarvis replies. It must belong to the configured organization and each channel where it may reply. |

See [Jarvis feedback bridge](../architecture/jarvis-feedback-bridge.md)
for the event contract, permissions, and rollout checklist.

### Production-only

The `wrangler.jsonc` config sets `WORKOS_REDIRECT_URI` as a Worker var pointing to the production domain. You don't need this locally since `NEXT_PUBLIC_WORKOS_REDIRECT_URI` covers it.


Development commands
---

### Core

| Command | What it does |
|---------|-------------|
| `bun dev` | Starts the Next.js dev server with Turbopack on port 3000. |
| `bun run build` | Production build via Next.js. |
| `bun preview` | Builds then runs on the Cloudflare Workers runtime locally. Good for catching runtime differences between Node and Workers. |
| `bun lint` | Runs ESLint across the codebase. |
| `bun deploy` | Builds with OpenNext and deploys to Cloudflare Workers. |

### Database

Compass uses Cloudflare D1 (SQLite) with Drizzle ORM. The schema is split across multiple files and Drizzle generates migrations from them.

| Command | What it does |
|---------|-------------|
| `bun run db:generate` | Generates migration SQL from schema changes. Run this after modifying any `src/db/schema*.ts` file. |
| `bun run db:migrate:local` | Applies pending migrations to your local D1 instance. |
| `bun run db:migrate:prod` | Applies pending migrations to the production D1 database. |

The schema files that Drizzle watches (configured in `drizzle.config.ts`):

```
src/db/schema.ts           - core tables (users, projects, customers, vendors, etc.)
src/db/schema-netsuite.ts  - legacy/generic NetSuite sync and financial tables
src/db/schema-plugins.ts   - plugin/skills tables
src/db/schema-agent.ts     - agent conversation tables
src/db/schema-ai-config.ts - AI usage tracking and model preferences
src/db/schema-theme.ts     - custom themes and user preferences
src/db/schema-google.ts    - google drive auth and starred files
src/db/schema-dashboards.ts - custom AI-built dashboards
```

Migrations live in `drizzle/` and are applied in order. Never modify an existing migration file - always generate a new one.

### Mobile (Capacitor)

The mobile app defaults to a purpose-built offline Field Mode shell. It is not a static export of the full Next.js application. The shell caches active project packets locally and syncs through the deployed Field Mode backend when connectivity is available.

| Command | What it does |
|---------|-------------|
| `bun cap:sync` | Builds the offline Field Mode shell and syncs it plus Capacitor plugins to the native projects. |
| `bun run cap:sync:live` | Developer-only fallback that wraps the full live web application; do not use for field releases. |
| `bun cap:ios` | Opens the Xcode project for iOS development. |
| `bun cap:android` | Opens the Android Studio project. |

### Other

| Command | What it does |
|---------|-------------|
| `bun run cf-typegen` | Regenerates the `cloudflare-env.d.ts` type definitions from `wrangler.jsonc` bindings. Run after changing Worker bindings. |


Running locally
---

1. Make sure `.dev.vars` has at least the WorkOS variables set.
2. Apply database migrations:
   ```bash
   bun run db:migrate:local
   ```
3. Start the dev server:
   ```bash
   bun dev
   ```
4. Open `http://localhost:3000`.

The Turbopack dev server is fast. Hot reload works for both server and client components.

To test against the actual Cloudflare Workers runtime (catches D1 quirks, binding issues, etc.):
```bash
bun preview
```

This builds with OpenNext, then runs a local Workers emulator. It's slower to start but more representative of production behavior.


Deploying
---

Compass deploys to Cloudflare Workers via OpenNext:

```bash
bun deploy
```

This runs `opennextjs-cloudflare build` followed by `opennextjs-cloudflare deploy`. The Worker is configured in `wrangler.jsonc` with:

- D1 database binding (`DB`)
- Assets binding for static files
- Cloudflare Images binding
- AI binding
- Self-reference service binding (for internal routing)
- Custom domain route (`compass.openrangeconstruction.ltd`)

Production secrets are set via `wrangler secret put <KEY>` and managed in the Cloudflare dashboard.


Project structure overview
---

```
src/
  app/           - Next.js App Router pages, API routes, server actions
  components/    - React components (ui/ for shadcn primitives)
  db/            - Drizzle schema files and getDb() helper
  hooks/         - Custom React hooks (including native/mobile hooks)
  lib/           - Business logic, integrations, utilities
  types/         - Global TypeScript type definitions

drizzle/         - Generated migration SQL files
ios/             - Xcode project (Capacitor)
android/         - Android Studio project (Capacitor)
docs/            - Documentation
public/          - Static assets
```

For a deeper dive into the architecture, see the `docs/architecture/` directory.
