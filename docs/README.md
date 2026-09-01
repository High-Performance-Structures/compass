Compass Documentation
===

Compass is two things: a platform and a product.

**Product principle:** serious tools, with soul. Compass should handle the
hard business machinery -- schedules, RFIs, purchase orders, budgets,
permissions, ERP sync, documents, and communication -- while still feeling
calm, humane, and worth using by the people doing the work.

**Compass Core** is an agentic dashboard platform -- authentication, an AI assistant, visual theming, a plugin system, and custom dashboards. It's built with Next.js 15, React 19, Cloudflare D1, and the AI SDK. It's generic. Any industry could use it.

**HPS Compass** is a construction project management product built on top of Compass Core. It adds scheduling with Gantt charts, Sage-oriented project operations and financial visibility, Google Drive integration for project documents, and a Capacitor mobile app for field workers. It's specific to construction, but the architecture is designed so other industries could build their own module packages.

**ERP status:** the repository still contains a NetSuite module because it was the first ERP sync implementation and remains useful architecture reference material. For HPS production work, Sage 100 Contractor is the active accounting, job cost, scheduling, purchase order, and billing integration target. See the WIP [Compass Google/Sage integration plan](wip/compass-google-sage-integration-plan.md), [Sage API bridge notes](wip/sage-api-bridge-2026-05-14.md), and [Compass security plan](wip/compass-security-plan-2026-05-19.md).


architecture
---

How the core platform works.

- [overview](architecture/overview.md) -- the two-layer architecture, tech stack, project structure, how everything connects
- [data layer](architecture/data-layer.md) -- Drizzle ORM on Cloudflare D1, schema conventions, migration workflow
- [server actions](architecture/server-actions.md) -- the data mutation pattern, auth checks, error handling, revalidation
- [auth system](architecture/auth-system.md) -- WorkOS integration, middleware, session management, RBAC
- [AI agent](architecture/ai-agent.md) -- OpenRouter provider, tool system, system prompt, unified chat architecture, usage tracking
- [Jarvis feedback bridge](architecture/jarvis-feedback-bridge.md) -- signed Signet bridge, unified feedback desk, Telegram/email routing, and reply policy
- [multi-tenancy](architecture/multi-tenancy.md) -- org isolation, demo mode guards, the requireOrg pattern, adding new server actions safely


modules
---

The construction-specific modules that make up HPS Compass.

- [overview](modules/overview.md) -- what the module system is, core vs module boundary, how modules integrate
- [netsuite](modules/netsuite.md) -- legacy/generic ERP sync reference: OAuth, HTTP client, rate limiter, sync engine, mappers, gotchas
- [sage bridge](wip/sage-api-bridge-2026-05-14.md) -- HPS active ERP path: server-side Sage 100 Contractor bridge and read-model strategy
- [google drive](modules/google-drive.md) -- domain-wide delegation, JWT auth, drive client, two-layer permissions, file browser
- [scheduling](modules/scheduling.md) -- Gantt charts, critical path analysis, dependency management, baselines, workday exceptions
- [financials](modules/financials.md) -- invoices, vendor bills, payments, credit memos, with legacy NetSuite sync notes and HPS Sage direction
- [contracts](modules/contracts.md) -- versioned contract library, project packet assembly, CA22 insertion, Foxit execution, and budget handoff
- [Nu-Tech orders](modules/nutech.md) -- Fox Blocks catalog, takeoffs, bracing rentals, Airlite purchase orders, and Sage-ready product mappings
- [mobile](modules/mobile.md) -- Capacitor native app, offline photo queue, push notifications, biometric auth
- [desktop](modules/desktop.md) -- Electron desktop app, hosted Compass runtime, native shell bridge, packaged app distribution
- [claude code](modules/claude-code.md) -- local bridge daemon, own Anthropic API key, filesystem + terminal tools, WebSocket protocol
- [social publishing](modules/social-publishing.md) -- department-routed Facebook, Instagram, and X project posts with AI drafts and privacy review
- [CHERISH cards](modules/cherish-cards.md) -- recognition-linked physical cards, digital e-card direction, fulfillment safety, and provider setup


development
---

How to work on Compass.

- [getting started](development/getting-started.md) -- local setup, environment variables, dev server, database, deployment
- [conventions](development/conventions.md) -- TypeScript discipline, component patterns, file organization
- [regression testing](development/regression-testing.md) -- pull-request, daily, native, and release regression strategy
- [sidebar](development/sidebar.md) -- sidebar component architecture, desktop vs mobile, collapsed state, animations
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
bun run desktop:dev  # electron desktop dev
bun run desktop:dist # electron desktop production package
bun lint             # eslint
```

See [getting started](development/getting-started.md) for full setup instructions.
