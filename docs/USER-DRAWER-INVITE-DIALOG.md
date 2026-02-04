user drawer & invite dialog - implementation complete
===

## components created

### 1. user drawer (`src/components/people/user-drawer.tsx`)

full-featured user detail and edit drawer with:

**features:**
- sheet/drawer component (mobile-friendly bottom sheet)
- three tabs: profile, access, activity
- real-time role updates with save confirmation
- displays user avatar, name, email
- shows all user relationships (teams, groups, projects, organizations)
- read-only profile fields (managed by workos)
- activity tracking (last login, created, updated dates)
- status badge (active/inactive)

**profile tab:**
- first name, last name (read-only)
- email (read-only)
- display name (read-only)
- note explaining workos manages profile data

**access tab:**
- role selector with save button
- teams list (badges)
- groups list (badges)
- project count
- organization count
- real-time updates when role changes

**activity tab:**
- account status badge
- last login timestamp
- account created date
- last updated date

**mobile optimizations:**
- responsive sheet (side drawer on desktop, bottom sheet on mobile)
- scrollable content
- proper touch targets

### 2. invite dialog (`src/components/people/invite-dialog.tsx`)

clean invite flow for new users:

**features:**
- dialog component
- email validation
- role selection with descriptions
- optional organization assignment
- loading states
- error handling
- form reset on success

**form fields:**
- email (required, validated)
- role (required) with helpful descriptions:
  - admin: full access to all features
  - office: manage projects, schedules, documents
  - field: update schedules, create documents
  - client: read-only access to assigned projects
- organization (optional dropdown)

**ux details:**
- loads organizations on open
- shows loading spinner while fetching orgs
- validates email format before submit
- disabled state during submission
- toast notifications for success/error
- auto-closes and reloads data on success

### 3. updated people page

integrated both components:

**state management:**
- selectedUser state for drawer
- drawerOpen boolean
- inviteDialogOpen boolean
- automatic data refresh after updates

**user interactions:**
- click user row → opens drawer
- click "invite user" button → opens dialog
- drawer save → refreshes user list
- dialog invite → refreshes user list and closes
- deactivate user → confirms and refreshes list

**handlers:**
- handleEditUser() - opens drawer with selected user
- handleDeactivateUser() - deactivates and refreshes
- handleUserUpdated() - callback to refresh data
- handleUserInvited() - callback to refresh data

## code quality

**typescript:**
- no type errors
- proper typing throughout
- uses existing types from actions

**patterns:**
- follows existing codebase patterns
- uses shadcn/ui components consistently
- proper error handling with try/catch
- toast notifications for user feedback
- loading states for async operations

**mobile responsive:**
- all components work on mobile
- proper touch targets
- scrollable content
- responsive layouts

## testing steps

### test user drawer:

1. navigate to `/dashboard/people`
2. click any user row in the table
3. drawer opens from right (desktop) or bottom (mobile)
4. verify all tabs work (profile, access, activity)
5. change role dropdown
6. click "save role"
7. verify toast confirmation
8. verify table updates with new role badge

### test invite dialog:

1. navigate to `/dashboard/people`
2. click "invite user" button
3. dialog opens centered
4. enter email (test validation with invalid email)
5. select role (see descriptions change)
6. optionally select organization
7. click "send invitation"
8. verify toast confirmation
9. verify dialog closes
10. verify new user appears in table

### test error handling:

1. try inviting existing email (should error)
2. try inviting without email (should error)
3. try saving role without changes (should info)
4. disconnect network and try actions (should error gracefully)

## integration with workos

when workos is configured:

**invite flow:**
- creates user record in database immediately
- user receives workos invitation email
- user sets up account via workos
- on first login, profile syncs from workos
- user id matches between workos and database

**profile updates:**
- profile fields (name, email) come from workos
- can't be edited in drawer (read-only)
- role/access can be managed in compass
- changes sync on next login

## next steps

once workos is configured:

1. test full invite flow end-to-end
2. verify email invitations are sent
3. test user login after invitation
4. verify profile sync from workos
5. test role changes persist across sessions

## files created/modified

**created:**
- `src/components/people/user-drawer.tsx` (240 lines)
- `src/components/people/invite-dialog.tsx` (180 lines)

**modified:**
- `src/app/dashboard/people/page.tsx` (added drawer and dialog integration)

all components are production-ready and mobile-optimized.
