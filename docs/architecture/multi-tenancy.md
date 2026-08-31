Multi-Tenancy and Data Isolation
===

Compass is a multi-tenant application. Multiple organizations share
the same database, the same workers, and the same codebase. This
means every query that touches user-facing data must be scoped to
the requesting user's organization, or you've built a system where
one customer can read another customer's financials.

This document covers the isolation model, the demo mode guardrails,
and the specific patterns developers need to follow when adding new
server actions or queries.


the threat model
---

Multi-tenancy bugs are quiet. They don't throw errors. They don't
crash the page. They return perfectly valid data -- it just belongs
to someone else. A user won't notice they're seeing invoices from
another org unless the numbers look wrong. An attacker, however,
will notice immediately.

The attack surface is server actions. Every exported function in
`src/app/actions/` is callable from the client. If a server action
takes an ID and fetches a record without checking that the record
belongs to the caller's org, any authenticated user can read any
record in the database by guessing or enumerating IDs.

The second concern is demo mode. Demo users get an authenticated
session (they need one to browse the app), but they should never
be able to write persistent state. Without explicit guards, a demo
user's "save" buttons work just like a real user's.


the org scope pattern
---

Every server action that reads or writes org-scoped data should
call `requireOrg(user)` immediately after authentication. This
function lives in `src/lib/org-scope.ts` and does one thing:
extracts the user's active organization ID, throwing if there
isn't one.

```typescript
import { requireOrg } from "@/lib/org-scope"

const user = await getCurrentUser()
if (!user) return { success: false, error: "Unauthorized" }

const orgId = requireOrg(user)
```

The org ID comes from the user's session, not from client input.
This is important -- if the client sends an `organizationId`
parameter, an attacker controls it. The server derives it from
the authenticated session, so the user can only access their own
org's data.


filtering by org
---

Tables fall into two categories: those with a direct
`organizationId` column, and those that reference org-scoped data
through a foreign key.

**Direct org column**: `customers`, `vendors`, `projects`,
`channels`, `teams`, `groups`. These are straightforward:

```typescript
const rows = await db.query.customers.findMany({
  where: (c, { eq }) => eq(c.organizationId, orgId),
  limit: cap,
})
```

When combining org filtering with search, use `and()`:

```typescript
where: (c, { eq, like, and }) =>
  and(
    eq(c.organizationId, orgId),
    like(c.name, `%${search}%`),
  )
```

**Indirect org reference**: `invoices`, `vendor_bills`,
`schedule_tasks`, `task_dependencies`. These don't have an
`organizationId` column -- they reference `projects`, which
does. The pattern is to first resolve the set of project IDs
belonging to the org, then filter using `inArray`:

```typescript
const orgProjects = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.organizationId, orgId))

const projectIds = orgProjects.map(p => p.id)

const rows = projectIds.length > 0
  ? await db.query.invoices.findMany({
      where: (inv, { inArray }) =>
        inArray(inv.projectId, projectIds),
      limit: cap,
    })
  : []
```

The `projectIds.length > 0` guard matters because `inArray`
with an empty array produces invalid SQL in some drivers.

**Detail queries** (fetching a single record by ID) should
verify ownership after the fetch:

```typescript
const row = await db.query.projects.findFirst({
  where: (p, { eq: e }) => e(p.id, projectId),
})

if (!row || row.organizationId !== orgId) {
  return { success: false, error: "not found" }
}
```

Returning "not found" rather than "access denied" is deliberate.
It avoids leaking the existence of records in other orgs.


why not a global middleware?
---

It might seem cleaner to add org filtering at the database layer
-- a global query modifier or a Drizzle plugin that automatically
injects `WHERE organization_id = ?` on every query. We considered
this and decided against it for three reasons.

First, not every table has an `organizationId` column. The
indirect-reference tables (invoices, schedule tasks) need joins
or subqueries, which a generic filter can't handle without
understanding the schema relationships.

Second, some queries are intentionally cross-org. The WorkOS
integration, for instance, needs to look up users across
organizations during directory sync. A global filter would need
an escape hatch, and escape hatches in security code tend to get
used carelessly.

Third, explicit filtering is auditable. When every server action
visibly calls `requireOrg(user)` and adds the filter, a reviewer
can see at a glance whether the query is scoped. Implicit
filtering hides the mechanism, making it harder to verify and
easier to accidentally bypass.

The tradeoff is boilerplate. Every new server action needs the
same three lines. We accept this cost because security-critical
code should be boring and obvious, not clever and hidden.


demo mode
---

The synthetic demo identity is restricted to the isolated end-to-end test
environment. Production `/demo` requests clear any stale demo and active-org
cookies and redirect to normal authentication. This fail-closed policy remains
in place until Compass has a physically separate demo datastore; a fake
organization ID in the shared production database is not a sufficient security
boundary because client-side route state can survive an identity transition.

In end-to-end tests, visiting `/demo` sets a `compass-demo` cookie and uses an
admin identity in a fake organization called "Meridian Group". It exists only
to exercise the full UI against isolated test data and must never be enabled on
the production deployment.

The demo user is defined in `src/lib/demo.ts`:

```typescript
export const DEMO_USER_ID = "demo-user-001"
export const DEMO_ORG_ID = "demo-org-meridian"

export function isDemoUser(userId: string): boolean {
  return userId === DEMO_USER_ID
}
```

Every mutating server action must check `isDemoUser` after
authentication and before any writes:

```typescript
if (isDemoUser(user.id)) {
  return { success: false, error: "DEMO_READ_ONLY" }
}
```

The `DEMO_READ_ONLY` error string is a convention. Client
components can check for this specific value to show a
"this action is disabled in demo mode" toast instead of a
generic error.

**Which actions need the guard**: any function that calls
`db.insert()`, `db.update()`, or `db.delete()`. Read-only
actions don't need it because the synthetic user is limited to isolated test
data.

**Where to place it**: immediately after the auth check, before
any database access. This keeps the pattern consistent across
all server action files and prevents accidental writes from
queries that run before the guard.


the demo cookie
---

In the isolated end-to-end environment, the `compass-demo` cookie uses
`sameSite: "strict"` rather than `"lax"`. This matters because the cookie
bypasses the WorkOS flow inside that test environment. Production middleware
ignores and deletes the cookie. With `"lax"`, the cookie would be sent on
cross-site top-level navigations (clicking a link from another site to Compass).
With `"strict"`, it's only sent on same-site requests.

The `compass-active-org` cookie (which tracks which org a real
user has selected) can remain `"lax"` because it doesn't bypass
authentication. It only influences which org's data is shown
after the user has already been authenticated through WorkOS.


files involved
---

The org scope and demo guard patterns are applied across these
server action files:

- `src/app/actions/dashboards.ts` -- org filtering on all
  dashboard query types (customers, vendors, projects, invoices,
  vendor bills, schedule tasks, and detail queries). Demo guards
  on save and delete.

- `src/app/actions/conversations.ts` -- org boundary check on
  `getChannel` and `joinChannel`. Without this, a user who knows
  a channel ID from another org could read messages or join the
  channel.

- `src/app/actions/chat-messages.ts` -- `searchMentionableUsers`
  derives org from session rather than accepting it as a client
  parameter. This prevents a client from searching users in
  other orgs by passing a different organization ID.

- `src/app/actions/ai-config.ts` -- `getConversationUsage`
  always filters by user ID, even for admins. An admin in org A
  has no business seeing token usage from org B, even if the
  admin permission technically allows broader access.

- `src/app/actions/plugins.ts` -- demo guards on install,
  uninstall, and toggle.

- `src/app/actions/themes.ts` -- demo guards on save and delete.

- `src/app/actions/mcp-keys.ts` -- demo guards on create,
  revoke, and delete.

- `src/app/actions/agent.ts` -- demo guards on save and delete
  conversation.

- `src/app/demo/route.ts` -- demo cookie set with
  `sameSite: "strict"`.

- `src/lib/org-scope.ts` -- the `requireOrg` utility.

- `src/lib/demo.ts` -- demo user constants and `isDemoUser`
  check.


adding a new server action
---

When writing a new server action that touches org-scoped data,
follow this pattern:

```typescript
"use server"

import { getCurrentUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function myAction(input: string) {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Unauthorized" }

  // demo guard (only for mutations)
  if (isDemoUser(user.id)) {
    return { success: false, error: "DEMO_READ_ONLY" }
  }

  // org scope (for any org-scoped data access)
  const orgId = requireOrg(user)

  // ... query with orgId filter
}
```

The order matters: authenticate, check demo, scope org, then
query. If you reverse the demo check and org scope, a demo user
without an org would get a confusing "no active organization"
error instead of the intended "demo read only" message.


known limitations
---

The org scope is enforced at the application layer, not the
database layer. This means a bug in a server action can still
leak data. SQLite (D1) doesn't support row-level security
policies the way PostgreSQL does, so there's no database-level
safety net. The mitigation is code review discipline: every PR
that adds or modifies a server action should be checked for
`requireOrg` usage.

The demo guard is also application-layer. If someone finds a
server action without the guard, they can mutate state through
the demo session. The mitigation is the same: review discipline
and periodic audits of server action files.

Both of these limitations would be addressed by moving to
PostgreSQL with row-level security in the future. That's a
significant migration, and the current approach is adequate for
the threat model (authenticated users in a B2B SaaS context,
not anonymous public access). But it's worth noting that the
current security model depends on developers getting every
server action right, rather than the database enforcing it
automatically.
