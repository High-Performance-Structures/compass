Coding Conventions
===

This document explains the conventions Compass follows and, more importantly, why. These aren't arbitrary rules - each one exists because it caught a real bug, prevented a class of errors, or made the codebase easier to work with at scale.


TypeScript discipline
---

The TypeScript config (`tsconfig.json`) targets ES2024 with strict mode enabled. The compiler is set to bundler module resolution, which means imports resolve the way Next.js expects them to. Beyond what the compiler enforces, we follow these additional conventions:

### No `any`

Every `any` is a hole in the type system. Use `unknown` instead and narrow with type guards. The difference matters: `any` silently disables checking on everything it touches, while `unknown` forces you to prove the type before using it.

```typescript
// instead of:
function process(data: any) { return data.name }

// write:
function process(data: unknown): string {
  if (typeof data === "object" && data !== null && "name" in data) {
    return String((data as Record<string, unknown>).name)
  }
  throw new Error("expected object with name")
}
```

### No `as` type assertions

Type assertions tell the compiler "trust me" - but the compiler is usually smarter than us. If you need `as`, it means the types don't actually line up and you should fix that instead. The exception is when interfacing with external libraries that have imprecise types, and even then prefer type guards.

### No `!` non-null assertions

The `!` operator says "I know this isn't null even though TypeScript thinks it might be." That's exactly the kind of assumption that causes runtime crashes. Check for null explicitly.

### Discriminated unions over optional properties

When a value can be in different states, encode those states as a union rather than making everything optional. This way the compiler enforces that you handle every case.

```typescript
// the server action pattern used throughout src/app/actions/:
type ActionResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }
```

Every server action in the codebase returns this shape. When you check `result.success`, TypeScript narrows the type and you can't accidentally access `data` on a failed result.

### `readonly` everywhere mutation isn't intended

Mark arrays as `ReadonlyArray<T>`, records as `Readonly<Record<K, V>>`, and interface properties as `readonly`. This catches accidental mutations at compile time. The theme system types are a good example - `ColorMap` is `Readonly<Record<ThemeColorKey, string>>` because theme colors should never be mutated after creation.

### No `enum`

Enums compile to runtime objects with bidirectional mappings, which is surprising and adds bundle weight. Use `as const` arrays with derived union types instead:

```typescript
// from src/lib/agent/plugins/types.ts:
export const PLUGIN_CAPABILITIES = [
  "tools",
  "actions",
  "components",
  "prompt",
  "queries",
] as const

export type PluginCapability =
  (typeof PLUGIN_CAPABILITIES)[number]
```

This gives you the same type safety, works with `Array.includes()` for runtime checks, and compiles to just an array.

### Branded types for IDs

Primitive types can be accidentally swapped - a user ID and a project ID are both strings, but passing one where the other is expected is a bug. Branded types prevent this:

```typescript
type SemVer = string & { readonly __brand: "SemVer" }
```

The plugin system uses this for version strings. The `isSemVer()` type guard validates the format and narrows the type.

### Explicit return types on exported functions

Every exported function declares its return type. This isn't redundant - it's documentation that the compiler enforces. It also prevents accidentally changing a function's return type when modifying its implementation.

### Effect-free module scope

No `console.log`, `fetch`, or mutations at the top level of any module. Side effects during import make code unpredictable and break tree-shaking. All the theme system's font loading, for example, happens inside `loadGoogleFonts()` - never at import time.


Server action conventions
---

All data mutations go through server actions in `src/app/actions/`. The pattern is consistent across the entire codebase:

```typescript
"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"

export async function doSomething(input: string): Promise<
  | { readonly success: true; readonly data: SomeType }
  | { readonly success: false; readonly error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "not authenticated" }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // ... do work ...

  revalidatePath("/dashboard/whatever")
  return { success: true, data: result }
}
```

The key parts:
1. `"use server"` directive at the top of the file
2. Auth check via `getCurrentUser()` - always first
3. Database access via `getCloudflareContext()` then `getDb(env.DB)`
4. Discriminated union return type - never throw, always return
5. `revalidatePath()` after mutations to update the client

Components never call `fetch()`. They call server actions for mutations and use server components for reads.


Validation schemas
---

Zod schemas live in `src/lib/validations/`, organized by domain. The `common.ts` file provides reusable primitives:

```typescript
// from src/lib/validations/common.ts:
export const emailSchema = z
  .string()
  .min(1, "Email address is required")
  .email("Please enter a valid email address")

export const currencySchema = z
  .number()
  .nonnegative("Amount cannot be negative")
  .multipleOf(0.01, "Amount must have at most 2 decimal places")

export const userRoles = [
  "admin", "executive", "accounting",
  "project_manager", "coordinator", "office",
] as const

export type UserRole = (typeof userRoles)[number]
```

Domain-specific schemas compose these primitives. Authentication schemas in `auth.ts`, financial schemas in `financial.ts`, etc. Form validation uses react-hook-form with `@hookform/resolvers` to connect Zod schemas to the UI.

One thing to note: the AI SDK v6 uses `zod/v4` internally, so tool input schemas import from `"zod/v4"` while the rest of the app uses regular `"zod"`. Keep these separate.


Component conventions
---

### shadcn/ui

Compass uses shadcn/ui with the new-york style variant. Components live in `src/components/ui/` and are added via:

```bash
bunx shadcn@latest add <component-name>
```

These are auto-generated and shouldn't be heavily customized. Build app-specific behavior in wrapper components instead.

### Class merging with cn()

```typescript
// from src/lib/utils.ts:
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

`cn()` combines `clsx` (conditional classes) with `tailwind-merge` (deduplicates conflicting Tailwind classes). Use it everywhere you compose class strings.

### Icons

Two icon libraries are configured with package import optimization in `next.config.ts`:

- `lucide-react` - primary icon set
- `@tabler/icons-react` - supplementary icons

Import icons directly: `import { IconName } from "lucide-react"`. The bundler tree-shakes unused icons.

### Animations

Two animation libraries coexist:
- `framer-motion` / `motion` - for complex, stateful animations
- Tailwind CSS animations via `tw-animate-css` - for simple transitions

### Data tables

Built on `@tanstack/react-table`. The pattern uses a `DataTable` component that takes column definitions and data arrays.

### Forms

React Hook Form with Zod resolvers. The validation schemas from `src/lib/validations/` plug directly into form configuration.


File organization
---

### Import aliases

The `tsconfig.json` configures a single path alias:

```json
{
  "paths": {
    "@/*": ["./src/*"]
  }
}
```

All imports from `src/` use `@/` prefix: `@/components/ui/button`, `@/lib/auth`, `@/db/schema`. No relative imports that climb more than one level.

### Directory responsibilities

- `src/app/actions/` - server actions, one file per domain (projects, customers, themes, plugins, etc.)
- `src/app/api/` - API routes for things that can't be server actions (streaming, webhooks, OAuth callbacks)
- `src/components/` - React components, grouped by feature (agent/, native/, netsuite/, files/)
- `src/components/ui/` - shadcn primitives only, don't put app logic here
- `src/db/` - schema definitions and the `getDb()` helper. Schema files are split by domain to keep them manageable.
- `src/hooks/` - custom hooks, including native/mobile hooks
- `src/lib/` - business logic, integrations, utilities. Subdirectories for major systems (agent/, netsuite/, google/, theme/, native/)
- `src/lib/validations/` - Zod schemas, organized by domain
- `src/types/` - global TypeScript type definitions

### Database schema files

Schema is split across files to avoid a single massive file. Drizzle config lists all of them:

```typescript
// drizzle.config.ts:
schema: [
  "./src/db/schema.ts",
  "./src/db/schema-netsuite.ts",
  "./src/db/schema-plugins.ts",
  "./src/db/schema-agent.ts",
  "./src/db/schema-ai-config.ts",
  "./src/db/schema-theme.ts",
  "./src/db/schema-google.ts",
  "./src/db/schema-dashboards.ts",
],
```

All tables use text IDs (UUIDs) and text dates (ISO 8601 strings). This is a deliberate choice for D1/SQLite compatibility - SQLite doesn't have native UUID or timestamp types, and storing them as text avoids ambiguity.


Environment access pattern
---

Cloudflare Workers don't have `process.env`. Environment variables come through the request context:

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare"

const { env } = await getCloudflareContext()
const db = getDb(env.DB)  // D1 binding
```

For environment variables that aren't D1 bindings (like API keys), access them as string properties on `env`. The Cloudflare type definitions from `wrangler.jsonc` are generated into `cloudflare-env.d.ts` via `bun run cf-typegen`.
