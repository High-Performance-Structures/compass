# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

compass
===

a construction project management system built with Next.js 15 + React 19, designed to replace BuilderTrend with a lean, self-hosted, open-source alternative. deployed to Cloudflare Workers via OpenNext.

quick start
---

```bash
bun dev          # turbopack dev server on :3000
bun run build        # production build
bun preview      # test build on cloudflare runtime
bun deploy       # build and deploy to cloudflare workers
bun lint         # run eslint
```

database commands:
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

tech stack
---

| layer | tech |
|-------|------|
| framework | Next.js 15 App Router, React 19 |
| language | TypeScript 5.x |
| ui | shadcn/ui (new-york style), Tailwind CSS v4 |
| charts | Recharts |
| database | Cloudflare D1 (SQLite) via Drizzle ORM |
| auth | WorkOS (SSO, directory sync) |
| ai agent | AI SDK v6 + OpenRouter (kimi-k2.5 model) |
| integrations | NetSuite REST API, Google Drive API |
| mobile | Capacitor (iOS + Android webview) |
| themes | 10 presets + AI-generated custom themes (oklch) |
| state | React Context, server actions |


critical architecture patterns
---

### server actions & data flow
- all data mutations go through server actions in `src/app/actions/`
- pattern: `return { success: true } | { success: false; error: string }`
- server actions revalidate paths with `revalidatePath()` to update client
- no fetch() in components - use actions instead
- environment variables accessed via `getCloudflareContext()` → `env.DB` for D1

### database
- drizzle ORM with D1 (SQLite dialect)
- text IDs (UUIDs), text dates (ISO 8601 format)
- migrations in `drizzle/` directory - **add new migrations, never modify old ones**
- schema files:
  - `src/db/schema.ts` - core tables (users, projects, customers, vendors, etc.)
  - `src/db/schema-netsuite.ts` - netsuite sync tables
  - `src/db/schema-plugins.ts` - plugins, plugin_config, plugin_events
  - `src/db/schema-theme.ts` - custom_themes, user_theme_preference

### authentication & middleware
- WorkOS handles SSO, email/password, directory sync
- middleware in `src/middleware.ts` checks session and redirects unauthenticated users to `/login`
- public paths: `/`, `/login`, `/signup`, `/reset-password`, `/verify-email`, `/invite`, `/callback`, `/api/auth/*`, `/api/netsuite/*`
- `getCurrentUser()` from `lib/auth.ts` returns user info with database lookup fallback

### ai agent harness
- located in `src/lib/agent/` - a complete AI-assisted system
  - `provider.ts`: OpenRouter setup for kimi-k2.5 model
  - `tools.ts`: queryData, navigateTo, showNotification, renderComponent, plus theme tools (listThemes, setTheme, generateTheme, editTheme) and plugin tools (installSkill, uninstallSkill, toggleInstalledSkill, listInstalledSkills)
  - `system-prompt.ts`: dynamic prompt builder with page/user context
  - `catalog.ts`: component specs for DynamicUI rendering
  - `chat-adapter.ts`: getTextFromParts, action registry, tool dispatch
- `src/app/api/agent/route.ts`: streamText endpoint with 10-step multi-tool loop
- `src/app/actions/agent.ts`: D1 persistence (save/load/delete conversations)
- unified chat architecture: one component, two presentations
  - `ChatProvider` (layout level) owns chat state + panel open/close + persistence
  - `ChatView variant="page"` on /dashboard (hero idle, typewriter, stats)
  - `ChatView variant="panel"` in `ChatPanelShell` on all other pages
  - `src/hooks/use-compass-chat.ts`: shared hook (useChat + action handlers + tool dispatch)
  - chat state persists across navigation
- usage tracking: `agent_config`, `agent_usage`, `user_model_preference` tables track tokens/costs per conversation, per-user model override if admin allows
- ai sdk v6 gotchas:
  - `inputSchema` not `parameters` for tool() definitions
  - UIMessage uses `parts` array, no `.content` field
  - useChat: `sendMessage({ text })` not `append({ role, content })`
  - useChat: `status` is "streaming"|"submitted"|"ready"|"error", not `isGenerating`
  - useChat: needs `transport: new DefaultChatTransport({ api })` not `api` prop
  - zod schemas must use `import { z } from "zod/v4"` to match AI SDK internals
  - ToolUIPart: properties may be flat or nested under toolInvocation

### netsuite integration
- full bidirectional sync via REST API
- key files in `src/lib/netsuite/`:
  - `config.ts`: account setup, URL builders
  - `auth/`: oauth 2.0 flow, token manager, AES-GCM encryption
  - `client/`: base HTTP client (retry, circuit breaker), record client, suiteql client
  - `rate-limiter/`: semaphore-based concurrency limiter (15 concurrent default)
  - `sync/`: sync engine, delta sync, conflict resolver, push logic, idempotency
  - `mappers/`: customer, vendor, project, invoice, vendor-bill mappers
- env vars: NETSUITE_CLIENT_ID, NETSUITE_CLIENT_SECRET, NETSUITE_ACCOUNT_ID, NETSUITE_REDIRECT_URI, NETSUITE_TOKEN_ENCRYPTION_KEY, NETSUITE_CONCURRENCY_LIMIT
- gotchas:
  - 401 errors can mean timeout, not auth failure
  - "field doesn't exist" often means permission denied
  - 15 concurrent request limit shared across ALL integrations
  - no batch create/update via REST (single record per request)
  - sandbox URLs use different separators (123456-sb1 vs 123456_SB1)
  - omitting "line" param on line items adds new line (doesn't update)

### capacitor mobile app
- webview-based native wrapper loading the live cloudflare deployment (not a static export)
- the web app must never break because of native code: all capacitor imports are dynamic (`await import()` inside effects), gated behind `isNative()` checks, components return `null` on web
- platform detection: `src/lib/native/platform.ts` exports `isNative()`, `isIOS()`, `isAndroid()`
- native hooks in `src/hooks/`: `use-native.ts`, `use-native-push.ts`, `use-native-camera.ts`, `use-biometric-auth.ts`, `use-photo-queue.ts`
- native components in `src/components/native/`: biometric lock screen, offline banner, status bar sync, upload queue indicator, push registration
- offline photo queue (`src/lib/native/photo-queue.ts`): survives app kill, uses filesystem + preferences + background uploader
- push notifications via FCM HTTP v1 (`src/lib/push/send.ts`), routes to both iOS APNS and Android FCM
- `src/app/api/push/register/route.ts`: POST/DELETE for device token management
- env: FCM_SERVER_KEY
- see `docs/native-mobile.md` for full iOS/Android setup and app store submission guide

### plugin/skills system
- agent can install external "skills" (github-hosted SKILL.md files in skills.sh format) or full plugin modules
- skills inject system prompt sections at priority 80, full plugins can also provide tools, components, query types, and action handlers
- source types: `builtin`, `local`, `npm`, `skills`
- key files in `src/lib/agent/plugins/`:
  - `types.ts`: PluginManifest, PluginModule, SkillFrontmatter
  - `skills-client.ts`: fetchSkillFromGitHub, parseSkillMd
  - `loader.ts`: loadPluginModule (local/npm/builtin)
  - `registry.ts`: buildRegistry, getRegistry (30s TTL cache per worker isolate)
- `src/app/actions/plugins.ts`: installSkill, uninstallSkill, toggleSkill, getInstalledSkills
- database: `plugins`, `plugin_config`, `plugin_events` tables in `src/db/schema-plugins.ts`

### visual theme system
- per-user themeable UI with 10 built-in presets + AI-generated custom themes
- themes are full oklch color maps (32 keys for light + dark), fonts (sans/serif/mono with google fonts), design tokens (radius, spacing, shadows)
- presets: native-compass (default), corpo, notebook, doom-64, bubblegum, developers-choice, anslopics-clood, violet-bloom, soy, mocha
- key files in `src/lib/theme/`:
  - `types.ts`: ThemeDefinition, ColorMap, ThemeFonts, ThemeTokens
  - `presets.ts`: all 10 preset definitions
  - `apply.ts`: `applyTheme()` injects css vars into `<style id="compass-theme-vars">`, instant without page reload
  - `fonts.ts`: `loadGoogleFonts()` dynamic `<link>` injection
- `src/app/actions/themes.ts`: getUserThemePreference, setUserThemePreference, saveCustomTheme, deleteCustomTheme
- database: `custom_themes`, `user_theme_preference` tables in `src/db/schema-theme.ts`

### google drive integration
- domain-wide delegation via service account (impersonates users by email)
- two-layer permissions: compass RBAC first, then google workspace permissions
- bidirectional: browse drive files in compass, upload from compass to drive, supports shared drives
- key files in `src/lib/google/`:
  - `auth/service-account.ts`: JWT creation, token exchange (web crypto API, RS256)
  - `client/drive-client.ts`: REST client with retry, rate limiting, impersonation
  - `mapper.ts`: DriveFile -> FileItem
- `src/app/actions/google-drive.ts`: 17 server actions (connect, disconnect, list, search, create, rename, move, trash, restore, upload, etc.)
- file browser UI in `src/components/files/`
- database: `google_auth`, `google_starred_files` tables, `users.google_email` column
- env: GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY
- see `docs/google-drive/GOOGLE-DRIVE-INTEGRATION.md` for full setup guide

### typescript discipline
- strict types: no `any`, no `as`, no `!` - use `unknown` with proper narrowing
- discriminated unions over optional properties: `{ status: 'ok'; data: T } | { status: 'error'; error: E }`
- `readonly` everywhere mutation isn't intended: `ReadonlyArray<T>`, `Readonly<Record<K, V>>`
- no `enum` - use `as const` objects or union types instead
- branded types for primitive identifiers to prevent mixing up IDs of different types
- explicit return types on all exported functions
- result types over exceptions: return `{ success: true } | { success: false; error }` from actions
- effect-free module scope: no `console.log`, `fetch`, or mutations during import

project structure
---

```
src/
├── app/                    # next.js app router
│   ├── (auth)/            # auth pages (login, signup, etc)
│   ├── api/               # api routes (agent, push, netsuite, auth)
│   ├── dashboard/         # protected dashboard routes
│   ├── actions/           # server actions (data mutations)
│   ├── globals.css        # tailwind + theme variables
│   ├── layout.tsx         # root layout
│   └── page.tsx           # home page
├── components/            # react components
│   ├── ui/               # shadcn/ui primitives (auto-generated)
│   ├── agent/            # ai chat (ChatView, ChatProvider, ChatPanelShell)
│   ├── native/           # capacitor mobile components
│   ├── netsuite/         # netsuite connection ui
│   ├── files/            # google drive file browser
│   └── *.tsx             # app-specific components
├── db/
│   ├── index.ts          # getDb() function
│   ├── schema.ts         # core drizzle schema
│   ├── schema-netsuite.ts # netsuite sync tables
│   ├── schema-plugins.ts  # plugin/skills tables
│   └── schema-theme.ts    # theme tables
├── hooks/                 # custom react hooks (incl. native hooks)
├── lib/
│   ├── agent/            # ai agent harness + plugins/
│   ├── google/           # google drive integration
│   ├── native/           # capacitor platform detection + photo queue
│   ├── netsuite/         # netsuite integration
│   ├── push/             # push notification sender
│   ├── theme/            # theme presets, apply, fonts
│   ├── auth.ts           # workos integration
│   ├── permissions.ts    # rbac checks
│   ├── utils.ts          # cn() for class merging
│   └── validations/      # zod schemas
└── types/                # global typescript types

ios/                       # xcode project (capacitor)
android/                   # android studio project (capacitor)
drizzle/                   # database migrations (auto-generated)
docs/                      # user documentation
public/                    # static assets
capacitor.config.ts        # capacitor native config
wrangler.jsonc             # cloudflare workers config
drizzle.config.ts          # drizzle orm config
next.config.ts             # next.js config
tsconfig.json              # typescript config
```

component conventions
---

shadcn/ui setup:
- new-york style
- add components: `bunx shadcn@latest add <component-name>`
- aliases: `@/components`, `@/components/ui`, `@/lib`, `@/hooks`

ui patterns:
- use `cn()` from `@/lib/utils.ts` for conditional classes
- form validation via react-hook-form + zod
- animations via framer-motion or tailwind css
- icons from lucide-react or @tabler/icons-react (both configured with package import optimization)
- data tables via tanstack/react-table

environment variables
---

dev: `.dev.vars` (gitignored)
prod: cloudflare dashboard secrets

required:
- WORKOS_API_KEY, WORKOS_CLIENT_ID
- OPENROUTER_API_KEY (for ai agent)
- NETSUITE_* (if using netsuite sync)
- GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY (if using google drive)
- FCM_SERVER_KEY (if using push notifications)

development tips
---

### accessing database in actions
```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare"
const { env } = await getCloudflareContext()
const db = env.DB // D1 binding
```

### using getCurrentUser() in actions
```typescript
import { getCurrentUser } from "@/lib/auth"
const user = await getCurrentUser()
if (!user) throw new Error("Not authenticated")
```

### revalidating paths after mutations
```typescript
import { revalidatePath } from "next/cache"
// after changing data
revalidatePath("/dashboard/projects") // specific path
revalidatePath("/", "layout") // entire layout
```

### querying data in components
- server components can use `getDb()` directly
- client components must call server actions
- never `fetch()` from client components - use actions

### type guards for discriminated unions
don't use `as` - write proper type guards:
```typescript
function isError<E>(result: { success: boolean; error?: E }): result is { success: false; error: E } {
  return !result.success && result.error !== undefined
}
```

known issues & WIP
---

- gantt chart vertical panning: zoom/horizontal pan work, but vertical pan conflicts with frappe-gantt container sizing. needs transform-based rendering approach with fixed header.

open source contribution notes
---

- repo at github.com/High-Performance-Structures/compass (private, invite-only)
- branching: `<username>/<feature>` off main
- conventional commits: `type(scope): subject`
- PRs are squash-merged to main
- deployment to cloudflare is manual via `bun deploy`
