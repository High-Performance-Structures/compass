Server Actions
===

Every data mutation in Compass goes through a server action. Not an API route, not a fetch call, not a GraphQL resolver. Server actions. This document explains the pattern, lists all 25 action files, and covers why this was chosen over alternatives.


the pattern
---

Every server action file starts with `"use server"` and exports async functions that follow a consistent shape:

```typescript
"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { customers, type NewCustomer } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function createCustomer(
  data: Omit<NewCustomer, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "customer", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(customers).values({
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/customers")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create customer",
    }
  }
}
```

The steps are always the same:

1. **Authenticate.** Call `getCurrentUser()` to get the current user from the WorkOS session.
2. **Authorize.** Call `requirePermission(user, resource, action)` to check RBAC. This throws if the user's role doesn't have the required permission.
3. **Get the database.** Call `getCloudflareContext()` for the D1 binding, then `getDb(env.DB)` for the Drizzle instance.
4. **Do the work.** Run the query/mutation.
5. **Revalidate.** Call `revalidatePath()` to bust the Next.js cache for affected pages.
6. **Return a discriminated union.** `{ success: true }` or `{ success: false; error: string }`.

The return type is the most important convention. Every mutation returns a discriminated union, never throws to the caller. This means the calling component always knows whether the operation succeeded and can show appropriate feedback without try/catch boilerplate.

Read-only actions (like `getCustomers()`) skip the try/catch wrapper and return data directly, since read failures are handled by the component's error boundary.


why server actions over API routes
---

Three reasons:

**Type safety.** Server actions are regular TypeScript functions. The parameter types and return types flow through the compiler. If you change the shape of `NewCustomer`, every call site that passes invalid data becomes a compile error. With API routes, you'd need to manually validate request bodies and keep client-side types in sync.

**No fetch boilerplate.** Calling a server action from a client component is a function call. No `fetch()`, no URL construction, no JSON serialization, no Content-Type headers. Next.js handles the RPC transport automatically.

**Automatic revalidation.** `revalidatePath()` inside a server action tells Next.js to refetch the data for that page. The client gets fresh data without explicitly re-querying. This is the mechanism that makes optimistic UI possible without a state management library.

The tradeoff: server actions are Next.js-specific. If you wanted to call these mutations from a mobile app or a third-party integration, you'd need to wrap them in API routes anyway. Compass handles this by having the Capacitor mobile app load the web UI directly (it's a WebView, so server actions work normally) and by exposing dedicated API routes only for external integrations (NetSuite callbacks, push notification registration).


accessing environment
---

Cloudflare Workers don't have `process.env`. Environment variables come from the Cloudflare runtime context:

```typescript
const { env } = await getCloudflareContext()
const db = getDb(env.DB)
```

For non-D1 environment variables (API keys, secrets), the common pattern casts `env` to a string record:

```typescript
const envRecord = env as unknown as Record<string, string>
const apiKey = envRecord.OPENROUTER_API_KEY
```

The double cast (`as unknown as Record<string, string>`) is necessary because the CloudflareEnv type is auto-generated and doesn't include manually-set secrets. This is the one place where the TypeScript discipline bends.


all action files
---

25 files in `src/app/actions/`, grouped by domain:

**core platform**

- `agent.ts` -- AI chat persistence (save/load/delete conversations)
- `agent-items.ts` -- agent-created items (todos, notes, checklists)
- `ai-config.ts` -- model configuration (get/set global model, user preferences, usage stats)
- `dashboards.ts` -- custom dashboard CRUD (save/load/delete/execute queries)
- `github.ts` -- GitHub API proxy (repo stats, commits, PRs, issues, create issues)
- `memories.ts` -- persistent memory CRUD (save, search, pin, delete)
- `plugins.ts` -- skill/plugin management (install, uninstall, toggle, list)
- `profile.ts` -- user profile updates
- `themes.ts` -- theme preference management (get/set preference, save/delete custom themes)
- `users.ts` -- user administration (list, update roles, deactivate)

**domain: people and orgs**

- `customers.ts` -- customer CRUD (create, read, update, delete)
- `vendors.ts` -- vendor CRUD
- `organizations.ts` -- organization management
- `teams.ts` -- team CRUD and membership
- `groups.ts` -- group CRUD and membership

**domain: projects and scheduling**

- `projects.ts` -- project listing (currently read-only, creation happens through the UI)
- `schedule.ts` -- schedule task CRUD (create, update, delete, reorder, bulk update)
- `baselines.ts` -- schedule baseline snapshots (save, load, delete)
- `workday-exceptions.ts` -- calendar exceptions (holidays, non-working days)

**domain: financials**

- `invoices.ts` -- invoice CRUD
- `vendor-bills.ts` -- vendor bill CRUD
- `payments.ts` -- payment recording
- `credit-memos.ts` -- credit memo management

**integrations**

- `netsuite-sync.ts` -- sync triggers, connection status, conflict resolution
- `google-drive.ts` -- 17 actions covering connect, disconnect, list, search, create, rename, move, trash, restore, upload, and more


the revalidation pattern
---

After every mutation, the action calls `revalidatePath()` to tell Next.js which pages have stale data:

```typescript
revalidatePath("/dashboard/customers")       // specific page
revalidatePath("/dashboard/customers", "page") // just the page, not the layout
revalidatePath("/", "layout")                 // the entire app (nuclear option)
```

This is what keeps the UI in sync without client-side state management. When `createCustomer()` returns `{ success: true }`, the customer list page already has a pending revalidation. The next render will show the new customer.

The pattern avoids over-revalidation. Each action revalidates only the paths it affects. `createCustomer()` revalidates `/dashboard/customers`, not the entire dashboard. This keeps cache invalidation surgical.


the permission check
---

Most mutation actions call `requirePermission()` before doing anything:

```typescript
const user = await getCurrentUser()
requirePermission(user, "customer", "create")
```

This throws an error if the user's role doesn't include the requested permission. The error is caught by the try/catch wrapper and returned as `{ success: false, error: "Permission denied: ..." }`.

Read-only actions use `requirePermission` with the "read" action. Some actions (like `getProjects()`) skip the permission check entirely because they return minimal data (just IDs and names) that's needed for UI dropdowns regardless of role.

The permission system is documented in detail in [auth-system.md](./auth-system.md).
