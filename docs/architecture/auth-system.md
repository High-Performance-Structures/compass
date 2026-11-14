Authentication and Authorization
===

Compass uses WorkOS for authentication and a custom RBAC system for authorization. This document covers both layers: how users get in, and what they're allowed to do once they're in.


why WorkOS
---

The decision came down to enterprise SSO. Construction companies have IT departments. Those IT departments use Active Directory, Okta, or Google Workspace. They want their employees to log in with their existing credentials, not create yet another account.

WorkOS provides SSO out of the box -- SAML, OIDC, and directory sync (meaning when someone gets added or removed in Active Directory, Compass picks it up automatically). Auth0 and Clerk offer similar features but at higher price points for the enterprise tier. WorkOS is SSO-first, which means the enterprise features aren't paywalled behind a premium plan.

The tradeoff: WorkOS's UI components are less polished than Clerk's, and the documentation assumes more backend knowledge. For a developer-built product, this is fine. For a no-code builder, it would be a problem.


the authentication flow
---

Authentication happens in three places: the middleware, the auth library, and the WorkOS SDK.

**Middleware** (`src/middleware.ts`) runs on every request. It does two things:

1. Gets the session from WorkOS via `authkit(request)`, which checks cookies and refreshes tokens automatically.
2. Decides whether to allow or redirect.

```typescript
export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { session, headers } = await authkit(request)

  if (isPublicPath(pathname)) {
    return handleAuthkitHeaders(request, headers)
  }

  if (!session.user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return handleAuthkitHeaders(request, headers, {
      redirect: loginUrl.toString()
    })
  }

  return handleAuthkitHeaders(request, headers)
}
```

Public paths bypass authentication entirely:

- `/`, `/login`, `/signup`, `/reset-password`, `/verify-email`, `/invite`, `/callback`
- `/api/auth/*` (WorkOS callback routes)
- `/api/netsuite/*` (OAuth callback from NetSuite)
- `/api/google/*` (Google integration webhooks)

Everything else requires a valid session. Unauthenticated users get redirected to `/login` with a `from` query parameter so they return to the right page after logging in.

The middleware matcher excludes static assets:

```typescript
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

**The auth library** (`src/lib/auth.ts`) provides `getCurrentUser()`, which is called by every server action that needs to know who's making the request.

```typescript
export async function getCurrentUser(): Promise<AuthUser | null> {
  const isWorkOSConfigured =
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    !process.env.WORKOS_API_KEY.includes("placeholder")

  if (!isWorkOSConfigured) {
    return {
      id: "dev-user-1",
      email: "dev@compass.io",
      // ... mock admin user for development
    }
  }

  const session = await withAuth()
  if (!session || !session.user) return null

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  let dbUser = await db
    .select()
    .from(users)
    .where(eq(users.id, workosUser.id))
    .get()

  if (!dbUser) {
    dbUser = await ensureUserExists(workosUser)
  }

  // update last login timestamp
  await db
    .update(users)
    .set({ lastLoginAt: now })
    .where(eq(users.id, workosUser.id))
    .run()

  return { /* AuthUser from DB fields */ }
}
```

The function has a development mode fallback. When WorkOS credentials aren't configured (or contain "placeholder"), it returns a mock admin user. This lets the app run locally without setting up WorkOS.

In production, the flow is:

1. Call WorkOS `withAuth()` to get the session from cookies
2. Look up the user in D1 by their WorkOS ID
3. If they don't exist in D1, create them with `ensureUserExists()` (auto-provisioning)
4. Update their `lastLoginAt` timestamp
5. Return an `AuthUser` object with the role from D1 (not from WorkOS)

The role comes from D1, not WorkOS, because roles are application-specific. WorkOS handles identity (who is this person?). Compass handles authorization (what can they do?).


auto-provisioning
---

When a user authenticates via WorkOS for the first time, `ensureUserExists()` creates their D1 record:

```typescript
export async function ensureUserExists(workosUser: {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
}): Promise<User> {
  // ... check if exists, return if so

  const newUser = {
    id: workosUser.id,
    email: workosUser.email,
    firstName: workosUser.firstName ?? null,
    lastName: workosUser.lastName ?? null,
    displayName: /* firstName + lastName, or email prefix */,
    avatarUrl: workosUser.profilePictureUrl ?? null,
    role: "guest", // least access; memberships decide the working role
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(users).values(newUser).run()
  return newUser
}
```

New accounts start as "guest", the least access. The role a person actually works with comes from their company or project membership (`resolveSessionRole` in `src/lib/domain/identity/session-role.ts`); `users.role` is only the fallback for someone with no membership at all. A person becomes staff only when an admin adds them to the company as staff. This is a security decision: no account should fall back to a staff role by accident.


session management
---

Sessions are managed by WorkOS's AuthKit SDK. The session cookie (`wos-session`) is a JWT that the middleware validates on every request. The SDK handles token refresh automatically -- when a session token is close to expiry, `authkit(request)` refreshes it and returns updated headers that the middleware passes through.

`src/lib/session.ts` provides two utility functions for JWT inspection:

```typescript
export function decodeJwtPayload(token: string): Record<string, unknown> | null
export function isTokenExpired(token: string): boolean
```

These are used for edge cases where the application needs to inspect the session token directly, outside the normal WorkOS flow.


developer View as
---

Admins in developer mode can open a live, read-only copy of another person's Compass (staff, owner or vendor) from the developer menu, the People sheet or Contacts. Code lives in `src/lib/view-as/` (its `constants.ts` header maps the files); the company setting is "View as" under Settings > People (admins only by default; listed staff may be added, never owners or vendors).

- **Session.** An httpOnly `compass-view-as` cookie holds an HMAC-signed token (who started it, whom, which company, expiry). `getCurrentUser()` re-checks it on every request: valid signature, same signed-in admin and company, admin still allowed, developer mode on, company setting on, viewed person still part of the company. If any check fails there is no user until the admin exits. `getSignedInUser()` returns the admin.
- **Read only, in layers.** (1) `getCloudflareContext()` returns read-only D1 and R2 bindings whenever the cookie is present, so no write from a server action, API route or page reaches the database: in a server action it throws "View as is read only", while rendering a page it is dropped quietly so the screen still renders; only `getUnguardedCloudflareContext()` (View as module and the admin's own sign-in housekeeping, enforced by a test) writes. (2) The middleware refuses non-GET `/api` requests. (3) Outside writes through `fetch()` (Gmail, Drive uploads, push, Sage, GitHub) are refused, and Gmail and Google Calendar are never fetched. (4) `assertAudiencePreviewWriteAllowed()` refuses early, and `useViewAsActive()` / `useAudiencePreviewReadOnly()` skip mark-read effects and disable preview-aware controls.
- **Company boundary.** The viewed identity carries `viewAsCompanyId` (the admin's company); project access and project lists stay inside it. The Listening Room is unreachable while viewing.
- **Audit.** Start and end (Exit, or `/view-as/ended` when the middleware finds a session expired or developer mode off) are written to Activity (category Access, `view_as.started` / `view_as.ended`, linked by a session id). Starting refuses if the entry cannot be written. The viewed person is not notified.


the RBAC system
---

Authorization is handled by `src/lib/permissions.ts`, which defines a static permission matrix.

**Roles.** The role list has one source: `USER_ROLES` in
`src/lib/domain/identity/statuses.ts`, with labels, groups and the named
predicates (`isInternalStaffRole`, `isExternalProjectRole`, ...) in
`src/lib/user-roles.ts`. Roles fall into four groups: administration
(`admin`, `secondary_admin`), internal staff (executive, project managers,
accounting, office, field and estimating roles), development, and external
project roles (`client`/owner, `subcontractor`, `supplier`, `guest`). Each
role maps to a permission set in `src/lib/permissions.ts`; legacy roles
(`office`, `field`, `coordinator`) are kept so old accounts and invite links
keep working. Compare roles only through those predicates: the
`compass-core/role-literal-compare` lint rule rejects literal role
comparisons elsewhere (see architecture-standards.md, section 1a).

**Thirteen resources:**

`project`, `schedule`, `budget`, `changeorder`, `document`, `user`, `organization`, `team`, `group`, `customer`, `vendor`, `finance`, `agent`

**Five actions:**

`create`, `read`, `update`, `delete`, `approve`

The permission matrix is a nested object:

```typescript
const PERMISSIONS: RolePermissions = {
  admin: {
    project: ["create", "read", "update", "delete", "approve"],
    schedule: ["create", "read", "update", "delete", "approve"],
    // ... full access to all resources
    agent: ["create", "read", "update", "delete"],
  },
  office: {
    project: ["create", "read", "update"],
    // ... no delete, no approve
    agent: ["read"],
  },
  field: {
    project: ["read"],
    schedule: ["read", "update"],
    // ... mostly read, some create
    agent: ["read"],
  },
  client: {
    project: ["read"],
    // ... read-only everything
    agent: [],
  },
}
```

The check functions:

```typescript
// returns boolean
export function can(user: AuthUser | null, resource: Resource, action: Action): boolean

// throws if not allowed
export function requirePermission(user: AuthUser | null, resource: Resource, action: Action): void

// returns allowed actions for a role/resource combo
export function getPermissions(role: string, resource: Resource): Action[]

// returns whether the user has ANY permission on a resource
export function hasAnyPermission(user: AuthUser | null, resource: Resource): boolean
```

`requirePermission()` is the most commonly used. It throws a descriptive error:

```
Permission denied: field cannot delete customer
```

This error gets caught by the server action's try/catch wrapper and returned as `{ success: false, error: "Permission denied: ..." }`.


notable design decisions
---

**Static over dynamic.** The permission matrix is a hardcoded object, not database rows. This means changing permissions requires a code change and deploy. The tradeoff is simplicity -- no admin UI for permission management, no risk of misconfiguration, no database queries to check permissions. For a product with a fixed role list and a well-defined permission model, this is the right call. If the permission model becomes more dynamic (per-project permissions, custom roles), the matrix would need to move to the database.

**Roles on users, not sessions.** The user's role is stored in D1 and returned by `getCurrentUser()`. It's not embedded in the JWT. This means role changes take effect on the next request, not the next login. The tradeoff is an extra database read per request (to get the role), but `getCurrentUser()` already reads the database to update `lastLoginAt`, so the role lookup comes for free.

**Agent access is a permission.** The AI agent is a resource in the RBAC system. Clients get no agent access (`agent: []`). Field workers get read-only (`agent: ["read"]`). This means the chat panel visibility can be gated on `can(user, "agent", "read")`. Admin gets full access, which includes configuring the model, viewing usage stats, and managing skills.

**Inactive users are denied everything.** The `can()` function checks `user.isActive` before checking permissions. A deactivated user gets `false` for every permission check, even if their role would normally allow it. This is the kill switch for removing access without deleting the user record.
