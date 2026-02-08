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

### NetSuite integration (optional)

Only needed if connecting to NetSuite for financial sync.

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

### Push notifications (optional, mobile)

| Variable | Description |
|----------|-------------|
| `FCM_SERVER_KEY` | Firebase Cloud Messaging server key for sending push notifications to iOS/Android. |

### GitHub deployment (optional)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub repo token for automatic deployments. |
| `GITHUB_REPO` | Repository in `owner/repo` format. Default: `High-Performance-Structures/compass`. |

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
src/db/schema-netsuite.ts  - netsuite sync tables
src/db/schema-plugins.ts   - plugin/skills tables
src/db/schema-agent.ts     - agent conversation tables
src/db/schema-ai-config.ts - AI usage tracking and model preferences
src/db/schema-theme.ts     - custom themes and user preferences
src/db/schema-google.ts    - google drive auth and starred files
src/db/schema-dashboards.ts - custom AI-built dashboards
```

Migrations live in `drizzle/` and are applied in order. Never modify an existing migration file - always generate a new one.

### Mobile (Capacitor)

The mobile app is a webview wrapper that loads the live Cloudflare deployment. It's not a static export.

| Command | What it does |
|---------|-------------|
| `bun cap:sync` | Syncs web assets and Capacitor plugins to native projects. Run after adding new Capacitor plugins. |
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
