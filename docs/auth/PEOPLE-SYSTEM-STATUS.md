people management system - implementation status
===

completed work
---

### phase 1: database and auth foundation ✅

**database schema** (`src/db/schema.ts`)
- users table (workos user sync)
- organizations table (internal vs client orgs)
- organization_members (user-org mapping)
- teams and team_members
- groups and group_members
- project_members (project-level access)
- migration generated and applied: `drizzle/0006_brainy_vulcan.sql`

**auth integration**
- workos authkit installed: `@workos-inc/authkit-nextjs`
- middleware with dev mode fallback: `src/middleware.ts`
  - bypasses auth when workos not configured
  - allows dev without real credentials
- auth utilities: `src/lib/auth.ts`
  - getCurrentUser() - returns mock user in dev mode
  - ensureUserExists() - syncs workos users to db
  - handleSignOut() - logout functionality
- permissions system: `src/lib/permissions.ts`
  - 4 roles: admin, office, field, client
  - resource-based permissions (project, schedule, budget, etc)
  - can(), requirePermission(), getPermissions() helpers
- callback handler: `src/app/callback/route.ts`

**environment setup**
- `.dev.vars` updated with workos placeholders
- `wrangler.jsonc` configured with WORKOS_REDIRECT_URI

### phase 2: server actions ✅

**user management** (`src/app/actions/users.ts`)
- getUsers() - fetch all users with relations
- updateUserRole() - change user role
- deactivateUser() - soft delete
- assignUserToProject() - project assignment
- assignUserToTeam() - team assignment
- assignUserToGroup() - group assignment
- inviteUser() - create invited user

**organizations** (`src/app/actions/organizations.ts`)
- getOrganizations() - fetch all orgs
- createOrganization() - create new org

**teams** (`src/app/actions/teams.ts`)
- getTeams() - fetch all teams
- createTeam() - create new team
- deleteTeam() - remove team

**groups** (`src/app/actions/groups.ts`)
- getGroups() - fetch all groups
- createGroup() - create new group
- deleteGroup() - remove group

all actions follow existing project patterns:
- use getCloudflareContext() for D1 access
- permission checks with requirePermission()
- return { success, error? } format
- revalidatePath() after mutations

### phase 3: basic ui ✅

**navigation**
- people nav item added to sidebar (`src/components/app-sidebar.tsx`)

**people page** (`src/app/dashboard/people/page.tsx`)
- client component with useEffect data loading
- loading state
- empty state
- table integration
- edit and deactivate handlers

**people table** (`src/components/people-table.tsx`)
- tanstack react table integration
- columns: checkbox, name/email, role, teams, groups, projects, actions
- search by name/email
- filter by role dropdown
- row selection
- pagination
- actions dropdown (edit, assign, deactivate)

**seed data**
- seed-users.sql with 5 users, 2 orgs, 2 teams, 2 groups
- applied to local database
- users include admin, office, field, and client roles

remaining work
---

### phase 4: advanced ui components

**user drawer** (`src/components/people/user-drawer.tsx`)
- full profile editing
- tabs: profile, access, activity
- role/team/group assignment
- avatar upload

**invite dialog** (`src/components/people/invite-user-dialog.tsx`)
- email input with validation
- user type selection (team/client)
- organization selection
- role/group/team assignment
- integration with inviteUser() action

**bulk actions** (`src/components/people/bulk-actions-bar.tsx`)
- appears when rows selected
- bulk role assignment
- bulk team/group assignment
- bulk deactivate

**supporting components**
- role-selector.tsx
- group-selector.tsx
- team-selector.tsx
- permissions-editor.tsx (advanced permissions UI)
- user-avatar-upload.tsx

### phase 5: workos configuration

**dashboard setup**
1. create workos account
2. create organization
3. get API keys (client_id, api_key)
4. generate cookie password (32+ chars)

**update credentials**
- `.dev.vars` - local development
- wrangler secrets - production
  ```bash
  wrangler secret put WORKOS_API_KEY
  wrangler secret put WORKOS_CLIENT_ID
  wrangler secret put WORKOS_COOKIE_PASSWORD
  ```

**test auth flow**
- login/logout
- user creation on first login
- session management
- redirect after auth

### phase 6: integration and testing

**end-to-end testing**
- invite user flow
- edit user profile
- role assignment
- team/group assignment
- project access
- permission enforcement
- mobile responsive
- accessibility

**cross-browser testing**
- chrome, firefox, safari
- mobile browsers

### phase 7: production deployment

**database migration**
```bash
bun run db:migrate:prod
```

**deploy**
```bash
bun deploy
```

**post-deployment**
- verify workos callback URL
- test production auth flow
- invite real users
- verify permissions

technical notes
---

### dev mode behavior
when workos env vars contain "placeholder" or are missing:
- middleware allows all requests through
- getCurrentUser() returns mock admin user
- no actual authentication happens
- allows building/testing UI without workos setup

### database patterns
- all IDs are text (UUIDs)
- all dates are text (ISO 8601)
- boolean columns use integer(mode: "boolean")
- foreign keys with onDelete: "cascade"
- getCloudflareContext() for D1 access in actions

### permission model
- role-based by default (4 roles)
- resource + action pattern
- extensible for granular permissions later
- enforced in server actions

### ui patterns
- client components use "use client"
- server actions called from client
- toast notifications for user feedback
- optimistic updates where appropriate
- revalidatePath after mutations

files created/modified
---

**new files**
- src/middleware.ts
- src/lib/auth.ts
- src/lib/permissions.ts
- src/app/callback/route.ts
- src/app/actions/users.ts
- src/app/actions/organizations.ts
- src/app/actions/teams.ts
- src/app/actions/groups.ts
- src/app/dashboard/people/page.tsx
- src/components/people-table.tsx
- src/components/people/ (directory for future components)
- drizzle/0006_brainy_vulcan.sql
- seed-users.sql

**modified files**
- src/db/schema.ts (added auth tables and types)
- src/components/app-sidebar.tsx (added people nav item)
- .dev.vars (added workos placeholders)
- wrangler.jsonc (added WORKOS_REDIRECT_URI)

next steps
---

1. **test current implementation**
   ```bash
   bun dev
   # visit http://localhost:3000/dashboard/people
   # verify table loads with seed data
   ```

2. **build user drawer** - most important next component
   - allows editing user profiles
   - assign roles/teams/groups
   - view activity

3. **build invite dialog** - enables adding new users
   - email validation
   - role selection
   - organization assignment

4. **configure workos** - when ready for real auth
   - set up dashboard
   - update credentials
   - test login flow

5. **deploy** - when ready
   - migrate prod database
   - set prod secrets
   - deploy to cloudflare

the foundation is solid. remaining work is primarily ui polish and workos configuration.
