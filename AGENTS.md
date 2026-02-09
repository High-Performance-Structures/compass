---
Repo: github.com/High-Performance-Structures/compass (public, invite-only) 
GitHub issues/comments/PR comments: use literal multiline strings or `-F - <<'EOF'` (or $'...') for real newlines; never embed "\\n".
Branching: `<username>/<feature>` off main
Conventional commits: `type(scope): subject`
PRs: squash-merged to main
Deployment: manual `bun deploy` or automatic through cloudflare/github integration
Last Updated: 2026/02/07
This file: AGENTS.md -> Symlinked to CLAUDE.md and GEMINI.md
---

# Repository Guidelines 


This file provides guidance to AI assistants when working on code 
in this repository. This file is version controlled, and written
by both human developers and AI assistants. All changes to this 
document--and the codebase, for that matter, are expected to be 
thoughtful, intentional and helpful. This document and/or it's 
symbolic links should never be overwritten or destroyed without care.
and running `/init` is **strongly** discouraged when working with 
less.. *corrigible* agents.

Documentation
---

- full documentation lives in `docs/` -- see [docs/README.md](docs/README.md).
- Docs content must be generic: no personal device 
names/hostnames/paths 

```bash
docs/
├── architecture/        # ai-agent, auth-system, data-layer, native-mobile, overview, server-actions
├── auth/                # rate-limits
├── development/         # conventions, getting-started, plugins, theming
├── google-drive/        # google-drive-integration
├── modules/             # financials, google-drive, mobile, netsuite, overview, scheduling
├── openclaw-principles/ # discord-integration, memory-system, openclaw-architecture, system-prompt-architecture, system-prompt
└── wip/                 # guides/, plans/, specs/, spec.json
```

This monorepo is split into modular layers:
---

*this is the goal that we are working towards*

1. Core: the agentic harness and ui layer. It sustains a secure, 
enterprise-ready architecture fit for bootstrapping AI powered project
management and collaborative dashboards *for any industry*. 
So other industries can drop in their own modules without touching it.
this keeps the architecture flexible and the developer environment clean.

2. Industries: prebuilt packages, ready-to-launch/deploy, built 
alongside domain experts from their respective sectors.
    - **HPS Compass** is construction project management package built on
    compass core. the architecture is designed so other industries could
    swap in their own module packages without touching core. And this 
    architecture helps to foster a flexible developer environment. 
    - Other packages are being planned, and contributions are always 
    welcome.

Deployment: 
---

As of writing, (February 2026) For the sake of easy deployment and 
stress testing, this project is configured to be deployed 
to Cloudflare Workers via OpenNext. However, in the future we plan 
to configure this for local deployments. 


Build, test, and development commands:
---

```bash
bun dev              # turbopack dev server (check if already running before running yourself. Restart after builds.) 
bun run build        # production build
bun preview          # test build on cloudflare runtime
bun deploy           # build and deploy to cloudflare workers
bun lint             # run eslint
```

database:
```bash
bun run db:generate      # generate drizzle migrations from schema
bun run db:migrate:local # apply migrations locally
bun run db:migrate:prod  # apply migrations to production D1
```

mobile (capacitor):
```bash
bun cap:sync             # sync web assets + plugins to native projects
bun cap:ios              # open xcode project
bun cap:android          # open android studio project
```

Style & Conventions
---

- Add brief code comments for tricky or non-obvious logic.
- Aim to keep files under ~700 LOC; guideline only (not a hard guardrail).
Split/refactor when it improves clarity or testability.
- **server actions** for all data mutations (`src/app/actions/`). return `{ success: true }` or `{ success: false; error: string }`. revalidate paths after writes. access D1 via `getCloudflareContext()`. see [docs/architecture/server-actions.md](docs/architecture/server-actions.md).
- **database**: drizzle ORM with D1 (SQLite). text IDs (UUIDs), text dates (ISO 8601). schema split across 8 files in `src/db/`. add new migrations, never modify old ones. see [docs/architecture/data-layer.md](docs/architecture/data-layer.md).
- **auth**: WorkOS for SSO/email/password. middleware in `src/middleware.ts` redirects unauthenticated users. `getCurrentUser()` from `lib/auth.ts` for user info. RBAC via `lib/permissions.ts`. see [docs/architecture/auth-system.md](docs/architecture/auth-system.md).
- **ai agent**: OpenRouter provider, tool-first design (queryData, navigateTo, renderComponent, theme tools, plugin tools). unified chat architecture -- one `ChatView` component with `variant="page"` or `variant="panel"`. `ChatProvider` at layout level owns state. see [docs/architecture/ai-agent.md](docs/architecture/ai-agent.md).

typescript discipline
---

these rules are enforced by convention, not tooling. see [docs/development/conventions.md](docs/development/conventions.md) for the reasoning behind each one.
> TODO: Add testing suite

- no `any` -- use `unknown` with narrowing
- no `as` -- fix the types instead of asserting
- no `!` -- check for null explicitly
- discriminated unions over optional properties
- `readonly` everywhere mutation isn't intended
- no `enum` -- use `as const` + union types
- explicit return types on exported functions
- result types over exceptions
- effect-free module scope

tech stack
---

| layer | tech |
|-------|------|
| framework | Next.js 15 App Router, React 19 |
| language | TypeScript 5.x (strict) |
| ui | shadcn/ui (new-york style), Tailwind CSS v4 |
| database | Cloudflare D1 (SQLite) via Drizzle ORM |
| auth | WorkOS (SSO, directory sync) |
| ai agent | AI SDK v6 + OpenRouter |
| integrations | NetSuite REST API, Google Drive API |
| mobile | Capacitor (iOS + Android webview) |
| themes | 10 presets + AI-generated custom themes (oklch) |
| deployment | Cloudflare Workers via OpenNext |



### HPS modules

each module contributes schema tables, server actions, components, and optionally agent tools. see [docs/modules/overview.md](docs/modules/overview.md) for the full module system design.

- **netsuite**: bidirectional ERP sync in `src/lib/netsuite/`. oauth, rate limiting (15 concurrent max), delta sync with conflict resolution. see [docs/modules/netsuite.md](docs/modules/netsuite.md).
- **google drive**: domain-wide delegation via service account in `src/lib/google/`. two-layer permissions (compass RBAC + workspace). see [docs/modules/google-drive.md](docs/modules/google-drive.md).
- **scheduling**: gantt charts, critical path, baselines in `src/lib/schedule/`. see [docs/modules/scheduling.md](docs/modules/scheduling.md).
- **financials**: invoices, vendor bills, payments, credit memos. tied to netsuite sync. see [docs/modules/financials.md](docs/modules/financials.md).
- **mobile**: capacitor webview wrapper. the web app must never break because of native code -- all capacitor imports are dynamic, gated behind `isNative()`. see [docs/modules/mobile.md](docs/modules/mobile.md) and [docs/architecture/native-mobile.md](docs/architecture/native-mobile.md).
- **themes**: per-user oklch color system, 10 presets, AI-generated custom themes. see [docs/development/theming.md](docs/development/theming.md).
- **plugins/skills**: github-hosted SKILL.md files inject into agent system prompt. full plugins provide tools, components, actions. see [docs/development/plugins.md](docs/development/plugins.md).
- **claude code bridge**: local daemon that routes inference through your own Anthropic API key. WebSocket connection gives the agent filesystem + terminal access alongside Compass tools. API key auth with scoped permissions. see [docs/modules/claude-code.md](docs/modules/claude-code.md).


project structure
---

```
src/
├── app/
│   ├── (auth)/            # auth pages (login, signup, etc)
│   ├── api/               # api routes (agent, push, netsuite, auth)
│   ├── dashboard/         # protected dashboard routes
│   ├── actions/           # server actions (25 files, all mutations)
│   ├── globals.css        # tailwind + theme variables
│   └── layout.tsx         # root layout (ChatProvider lives here)
├── components/
│   ├── ui/               # shadcn/ui primitives
│   ├── agent/            # ai chat (ChatView, ChatProvider, ChatPanelShell)
│   ├── native/           # capacitor mobile components
│   ├── netsuite/         # netsuite connection ui
│   ├── files/            # google drive file browser
│   ├── financials/       # invoice/bill components
│   ├── schedule/         # gantt and scheduling
│   └── people/           # user management
├── db/
│   ├── schema.ts         # core tables
│   ├── schema-netsuite.ts
│   ├── schema-plugins.ts
│   ├── schema-theme.ts
│   ├── schema-dashboards.ts
│   ├── schema-agent.ts
│   ├── schema-ai-config.ts
│   └── schema-google.ts
├── hooks/                 # react hooks (chat, native, audio)
├── lib/
│   ├── agent/            # ai agent harness + plugins/
│   ├── google/           # google drive integration
│   ├── native/           # capacitor platform detection + photo queue
│   ├── netsuite/         # netsuite integration
│   ├── push/             # push notification sender
│   ├── schedule/         # scheduling computation
│   ├── theme/            # theme presets, apply, fonts
│   ├── auth.ts           # workos integration
│   ├── permissions.ts    # rbac checks
│   └── validations/      # zod schemas
└── types/                # global typescript types

docs/                      # full documentation (start with docs/README.md)
drizzle/                   # database migrations (auto-generated)
ios/                       # xcode project (capacitor)
android/                   # android studio project (capacitor)
```


component conventions
---

- shadcn/ui new-york style. add components: `bunx shadcn@latest add <component-name>`
- aliases: `@/components`, `@/components/ui`, `@/lib`, `@/hooks`
- `cn()` from `@/lib/utils.ts` for conditional class merging
- form validation: react-hook-form + zod
- icons: lucide-react or @tabler/icons-react
- data tables: tanstack/react-table
- charts: recharts

environment variables
---

dev: `.env.local` or `.dev.vars` (both gitignored, identical content in each.) prod: cloudflare dashboard secrets.

required:
- `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` -- authentication
- `OPENROUTER_API_KEY` -- ai agent

> Todo: create friendlier deployment configuration for developers without access to cloudflare, 
environment variables, and openrouter.

optional (enable specific modules):
- `NETSUITE_CLIENT_ID`, `NETSUITE_CLIENT_SECRET`, `NETSUITE_ACCOUNT_ID`, `NETSUITE_REDIRECT_URI`, `NETSUITE_TOKEN_ENCRYPTION_KEY` -- netsuite sync
- `NETSUITE_CONCURRENCY_LIMIT` -- defaults to 15
- `GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY` -- google drive
- `FCM_SERVER_KEY` -- push notifications

see [docs/development/getting-started.md](docs/development/getting-started.md) for full setup.


gotchas
---

sharp edges that will cost you debugging time if you don't know about them upfront.

### ai sdk v6

- `inputSchema` not `parameters` for `tool()` definitions
- `UIMessage` uses `parts` array -- there is no `.content` field
- `useChat`: `sendMessage({ text })` not `append({ role, content })`
- `useChat`: `status` is `"streaming" | "submitted" | "ready" | "error"`, not `isGenerating`
- `useChat`: needs `transport: new DefaultChatTransport({ api })` not `api` prop
- zod schemas must use `import { z } from "zod/v4"` to match AI SDK internals
- `ToolUIPart`: properties may be flat or nested under `toolInvocation`

### netsuite

- 401 errors can mean request timeout, not just auth failure
- "field doesn't exist" often means permission denied, not a missing field
- 15 concurrent request limit is shared across ALL integrations on the account
- no batch create/update via REST -- single record per request
- sandbox URLs use different separators (`123456-sb1` in URLs vs `123456_SB1` in account ID)
- omitting the `line` param on line items adds a new line instead of updating

see [docs/modules/netsuite.md](docs/modules/netsuite.md) for full context.


