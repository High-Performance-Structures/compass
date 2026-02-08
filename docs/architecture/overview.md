Compass Core Architecture
===

Compass is a construction project management platform, but the architecture underneath it is designed to be something more general: a composable, AI-native dashboard framework that can serve any domain. The construction-specific features (schedules, change orders, submittals) are a *module* built on top of a generic platform layer. This document describes that platform layer.


why two layers
---

Enterprise software tends to calcify into monoliths. BuilderTrend, Procore, and their competitors each bundle project management, accounting, document management, and communication into a single product. If you want the scheduling but not the accounting, too bad. If their accounting doesn't match your workflow, too bad again.

The alternative is composability. Compass Core provides the infrastructure that every enterprise tool needs: authentication, authorization, a database layer, an AI agent, a plugin system, and a theming engine. Domain-specific features are modules that plug into this infrastructure. The construction module is the first one. It won't be the last.

This isn't theoretical. The architecture already enforces the separation. Core platform tables (users, organizations, themes, plugins, agent conversations) live in dedicated schema files. Domain tables (projects, schedules, customers, vendors, invoices) live in their own schema files. The AI agent's tools query domain data through the same server action layer that the UI uses. Swapping the domain module means replacing the schema files and the action handlers, not rewiring the platform.


the layers in practice
---

```
+--------------------------------------------------+
|              HPS Compass Module                   |
|  (projects, schedules, customers, vendors,        |
|   invoices, vendor bills, NetSuite sync,          |
|   Google Drive, Gantt charts)                     |
+--------------------------------------------------+
|              Compass Core Platform                |
|  +--------------------------------------------+  |
|  | AI Agent        | Plugins/Skills  | Themes  |  |
|  | (tools, system  | (install from   | (10     |  |
|  |  prompt, chat   |  GitHub, inject |  presets |  |
|  |  persistence,   |  into prompt,   |  + AI-   |  |
|  |  usage tracking)|  per-user)      |  gen'd)  |  |
|  +--------------------------------------------+  |
|  | Auth (WorkOS)   | RBAC            | Dashbds  |  |
|  | (SSO, email/pw, | (4 roles, 13    | (agent-  |  |
|  |  directory sync) |  resources,     |  built,  |  |
|  |                 |  5 actions)     |  saved)   |  |
|  +--------------------------------------------+  |
|  | Server Actions  | Drizzle + D1    | Next.js  |  |
|  | (typed RPC,     | (SQLite at the  | 15 App   |  |
|  |  revalidation)  |  edge)          | Router)  |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
|              Cloudflare Workers Runtime            |
|  (D1, KV, R2, edge deployment, zero cold start)  |
+--------------------------------------------------+
```

The bottom layer is the Cloudflare Workers runtime. Compass deploys as a Next.js 15 application via OpenNext, running on Cloudflare's edge network. The database is Cloudflare D1 (SQLite), co-located with the worker for single-digit-millisecond query latency.

The middle layer is Compass Core. This is where the platform capabilities live: authentication via WorkOS, role-based access control, the server action pattern for all data mutations, the AI agent harness, the plugin/skills system, the visual theme engine, and agent-built custom dashboards.

The top layer is the domain module. For HPS (High Performance Structures), this is construction project management. The module contributes its own database tables, server actions, UI pages, and AI agent tools. It also brings integrations (NetSuite for accounting, Google Drive for document management) that make sense for the construction domain.


relationship to OpenClaw
---

Compass's AI architecture was informed by studying OpenClaw's agent framework. The key ideas that carried over:

- *Section-based prompt building.* OpenClaw assembles system prompts from independent section builders, each returning a string array. Compass does exactly this in `buildSystemPrompt()` -- identity, user context, memory, domain knowledge, tool docs, guidelines, and plugin sections are each built by separate functions and concatenated. Sections can be omitted entirely based on a `PromptMode` parameter ("full", "minimal", "none").

- *Tool-first agent design.* The agent's primary interface with the application is through tools, not free-text generation. `queryData` reads the database, `navigateTo` controls the UI, `generateUI` builds dashboards, `rememberContext` persists memories. The LLM's text output is the explanation layer; the tools are the action layer.

- *Plugin extensibility through prompt injection.* OpenClaw's skills system lets external files inject instructions into the system prompt. Compass implements the same pattern: GitHub-hosted SKILL.md files get parsed, stored in the database, and injected into the prompt at priority 80 during the next agent invocation.

Where Compass diverges from OpenClaw is in the transport layer. OpenClaw uses a gateway with multi-channel routing (WhatsApp, Telegram, Discord, IDE). Compass uses a single HTTP streaming endpoint (`POST /api/agent`) because it only needs to serve its own web UI. This is simpler but means Compass doesn't get OpenClaw's multi-channel capabilities out of the box.


the tech stack
---

| layer       | choice                          | why                                              |
|-------------|--------------------------------|--------------------------------------------------|
| framework   | Next.js 15, React 19           | App Router, server components, server actions     |
| language    | TypeScript 5.x (strict)        | No `any`, no `as`, discriminated unions           |
| ui          | shadcn/ui + Tailwind CSS v4    | Composable primitives, not a component library    |
| database    | Drizzle ORM + Cloudflare D1    | Type-safe SQL, edge-native SQLite                 |
| auth        | WorkOS AuthKit                 | Enterprise SSO from day one                       |
| ai          | AI SDK v6 + OpenRouter         | Model-agnostic, streaming, multi-tool loops       |
| mobile      | Capacitor                      | WebView wrapper, same codebase                    |
| deployment  | Cloudflare Workers via OpenNext | Edge deployment, zero cold starts                 |

The choices are opinionated. D1 over Postgres means giving up some SQL features in exchange for edge co-location and zero-config. WorkOS over Auth0/Clerk means paying more but getting enterprise SSO without building it. OpenRouter over direct provider APIs means one integration point for any model. Each tradeoff is documented in detail in the relevant architecture doc.


file organization
---

The codebase follows Next.js 15 App Router conventions with a few additions:

- `src/app/actions/` -- server actions (25 files, all data mutations)
- `src/db/` -- Drizzle schema files (8 files, split by domain)
- `src/lib/agent/` -- AI agent harness (provider, tools, prompt, memory, plugins)
- `src/lib/theme/` -- visual theme engine (presets, apply, fonts)
- `src/lib/netsuite/` -- NetSuite integration (auth, client, sync, mappers)
- `src/lib/google/` -- Google Drive integration (auth, client, mapper)
- `src/components/agent/` -- chat UI (ChatProvider, ChatView, ChatPanelShell)
- `src/hooks/` -- shared React hooks (chat, native, audio)

Each subsystem is documented in its own architecture doc:

- [data-layer.md](./data-layer.md) -- database schema, Drizzle ORM, D1, migrations
- [server-actions.md](./server-actions.md) -- the server action pattern, all 25 action files
- [auth-system.md](./auth-system.md) -- WorkOS, middleware, RBAC, sessions
- [ai-agent.md](./ai-agent.md) -- the AI agent harness, tools, prompt, chat architecture
