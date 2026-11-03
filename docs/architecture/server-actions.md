Server Actions
===

Every data mutation in Compass goes through a server action. Not an API route, not a fetch call, not a GraphQL resolver. Server actions. This document explains the pattern and why it was chosen. The ownership rules it follows are in the [architecture and data standard](../development/architecture-standards.md).


the pattern
---

A server action is a thin adapter. It resolves the request context, calls the domain module that owns the data, revalidates, and returns a result:

```typescript
"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, type ActionResult } from "@/lib/action-result"
import { createCustomer as createCustomerRecord } from "@/lib/domain/contacts/store"
import { orgContext } from "@/lib/server/action-context"

export async function createCustomer(
  input: CustomerInput
): Promise<ActionResult<{ readonly id: string }>> {
  const context = await orgContext({ feature: "customers", action: "create", mutation: true })
  if (!context.success) return context
  try {
    const id = await createCustomerRecord(context.data, input)
    revalidatePath("/dashboard/customers")
    return { success: true, data: { id } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create customer") }
  }
}
```

The steps are always the same:

1. **Resolve the context.** `orgContext()` or `projectContext(projectId, { scope })` from `src/lib/server/action-context.ts` authenticates the user, finds their organization, checks the feature permission, refuses writes from the read-only demo, and returns `{ user, organizationId, db, env }`. A failure is already an `ActionFailure`, so return it as is. `projectContext` also returns the project, read once, using the scope the action needs: `"organization"` for staff work in the project's own company, `"member"` for anyone with project access (invited owners and vendors included).
2. **Do the work in the domain module.** The module's `store.ts` is the only code that writes its tables. Its `rules.ts` holds pure logic such as numbering, totals, and status transitions.
3. **Revalidate.** Call `revalidatePath()` to bust the Next.js cache for affected pages.
4. **Return a discriminated union.** Use `ActionDone` (`{ success: true }` or a failure) or `ActionResult<T>` (`{ success: true; data }` or a failure) from `src/lib/action-result.ts`.

The return type is the most important convention. Every mutation returns a discriminated union and never throws to the caller. The calling component always knows whether the operation succeeded and can show feedback without try/catch boilerplate.

Read-only loaders may return data directly and let the page's error boundary handle failures.


why server actions over API routes
---

Three reasons:

**Type safety.** Server actions are regular TypeScript functions, so parameter and return types flow through the compiler. An API route needs request bodies validated by hand and client types kept in sync.

**No fetch boilerplate.** Calling a server action from a client component is a function call. Next.js handles the transport.

**Automatic revalidation.** `revalidatePath()` inside a server action tells Next.js to refetch the data for that page, so the client gets fresh data without re-querying.

The tradeoff: server actions are Next.js-specific. The Capacitor mobile app loads the web UI directly (it is a WebView, so server actions work normally). Dedicated API routes exist only for outside callers (integrations, webhooks, the agent API), and they use the same context and domain modules as actions.


accessing environment
---

`orgContext()` returns the Cloudflare `env`. Read configured strings and flags through `src/lib/shared/env.ts`:

```typescript
import { envString } from "@/lib/shared/env"

const apiKey = envString(context.data.env, "OPENROUTER_API_KEY")
```

`envString` checks the Worker binding first, then `process.env` (local development and tests), and returns `null` for a missing or blank value. Do not cast `env` with `as unknown as Record<string, string>`; the architecture ratchet counts and blocks new casts.


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

Pass the feature to the context instead of checking permissions by hand:

```typescript
const context = await orgContext({ feature: "customers", action: "create", mutation: true })
if (!context.success) return context // "Permission denied: ..." among others
```

`action` defaults to `"read"`, or `"update"` when `mutation` is true. The check applies the role defaults plus the company's role, team, and individual overrides, which are loaded once per request. Loaders that return only ids and names for pickers may skip the feature check, but still start from `orgContext()` so the organization scope is enforced.

The permission system is documented in detail in [auth-system.md](./auth-system.md).
