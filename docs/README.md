Compass Documentation
===

Compass is two things: a platform and a product.

**Compass Core** is an agentic dashboard platform -- authentication, an AI assistant, visual theming, a plugin system, and custom dashboards. It's built with Next.js 15, React 19, Cloudflare D1, and the AI SDK. It's generic. Any industry could use it.

**HPS Compass** is a construction project management product built on top of Compass Core. It adds scheduling with Gantt charts, financial tracking tied to NetSuite, Google Drive integration for project documents, and a Capacitor mobile app for field workers. It's specific to construction, but the architecture is designed so other industries could build their own module packages.


architecture
---

How the core platform works.

- [overview](architecture/overview.md) -- the two-layer architecture, tech stack, project structure, how everything connects
- [data layer](architecture/data-layer.md) -- Drizzle ORM on Cloudflare D1, schema conventions, migration workflow
- [server actions](architecture/server-actions.md) -- the data mutation pattern, auth checks, error handling, revalidation
- [auth system](architecture/auth-system.md) -- WorkOS integration, middleware, session management, RBAC
- [AI agent](architecture/ai-agent.md) -- OpenRouter provider, tool system, system prompt, unified chat architecture, usage tracking


modules
---

The construction-specific modules that make up HPS Compass.

- [overview](modules/overview.md) -- what the module system is, core vs module boundary, how modules integrate
- [netsuite](modules/netsuite.md) -- bidirectional ERP sync: OAuth, HTTP client, rate limiter, sync engine, mappers, gotchas
- [google drive](modules/google-drive.md) -- domain-wide delegation, JWT auth, drive client, two-layer permissions, file browser
- [scheduling](modules/scheduling.md) -- Gantt charts, critical path analysis, dependency management, baselines, workday exceptions
- [financials](modules/financials.md) -- invoices, vendor bills, payments, credit memos, NetSuite sync tie-in
- [mobile](modules/mobile.md) -- Capacitor native app, offline photo queue, push notifications, biometric auth


development
---

How to work on Compass.

- [getting started](development/getting-started.md) -- local setup, environment variables, dev server, database, deployment
- [conventions](development/conventions.md) -- TypeScript discipline, component patterns, file organization
- [theming](development/theming.md) -- oklch color system, preset themes, custom theme generation, how applyTheme works
- [plugins](development/plugins.md) -- skills system, plugin manifests, registry, building new plugins


quick reference
---

```bash
bun dev              # dev server on :3000
bun run build        # production build
bun deploy           # build + deploy to cloudflare workers
bun run db:generate  # generate migrations from schema
bun run db:migrate:local  # apply migrations locally
bun run db:migrate:prod   # apply migrations to production
bun lint             # eslint
```

See [getting started](development/getting-started.md) for full setup instructions.
