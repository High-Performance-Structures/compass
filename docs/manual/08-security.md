# 8. Security and access

## 8.1 Roles

Roles are defined in `USER_ROLES` (`src/lib/user-roles.ts`). A person's role is per organization, and it decides their default permissions.

| Group | Roles |
|---|---|
| Administrators | `admin`, `secondary_admin` |
| Executive and finance | `executive`, `accounting` |
| Office and project | `project_manager`, `project_administrator`, `assistant_project_manager`, `office_manager`, `office`, `lead_estimator`, `assistant_estimator`, `architectural_designer`, `drafter` |
| Field | `field_superintendent`, `field_crew` |
| Technical | `developer` |
| External | `client`, `subcontractor`, `supplier`, `guest` |
| Legacy (still accepted) | `coordinator`, `field` |

`isInternalStaffRole()` separates staff from external roles. `isExternalProjectRole()` also treats a project-level `owner` as external.

## 8.2 Permission matrix

`src/lib/permissions.ts` grants actions on resources by role.

- **Resources:** `project`, `schedule`, `budget`, `changeorder`, `document`, `user`, `organization`, `team`, `group`, `customer`, `vendor`, `finance`, `bill_submission`, `agent`, `channels`, `help`.
- **Actions:** `create`, `read`, `update`, `delete`, `approve`, `moderate`.

| Permission set | Applies to | Summary |
|---|---|---|
| ADMIN | admin, secondary_admin | Everything: create, read, update, delete and approve on project work and finance; manage users, organizations, teams, groups and the agent; moderate channels |
| INTERNAL_PROJECT | office, project, estimating and design roles | Create, read and update project work, customers, vendors, finance and bill submissions; read-only on users, organizations, teams, groups and the agent; no delete or approve |
| executive | executive | Internal project set plus finance read and approve |
| accounting | accounting | Internal project set plus finance create, read, update and approve |
| developer | developer | Project read and update; create, read and update on schedule, budget, change orders, documents and channels |
| FIELD | field roles | Mostly read; schedule update; create change orders, documents, bill submissions and messages |
| EXTERNAL | supplier, guest | Read-only project data; bill submissions |
| EXTERNAL + change requests | client, subcontractor | The external set plus change-order create (change requests) |

`can(user, resource, action)` denies inactive users and unknown roles. `requirePermission` throws on denial.

Helpers for specific abilities:

- `canUseAskCompass`
- `canUseFieldDesk`
- `canUseOfficeTalk`
- `canCreateProjectDriveFolder`
- `canPrepareGreetingCards`
- `canManageWorkCalendarEvents`
- `canCreateProject`
- `canManageProjectRegistry` (admins only)
- `canManageUserAccess` (admins only)

## 8.3 Feature permissions and overrides

On top of the matrix, about 43 *features* (`PERMISSION_FEATURES`) each have an access level: `none`, `view`, `edit`, `delete` or `approve`. Examples are project photos, RFQs and change orders.

`getEffectivePermissionAccessLevel` (`src/lib/permission-enforcement.ts`) applies, in order:

1. the role baseline;
2. a company override for the role (`role_permission_overrides`);
3. team overrides, which can only raise the level (`team_permission_overrides`);
4. a per-user override for *staff-assignable* features, which may also deny (`user_permission_overrides`).

Two kinds of feature have extra rules:

- **Individual-only** features, such as private employee contact details, accounting contact review, values-board review, greeting-card approval and the project archive, need an explicit per-user grant. They are given only to active internal staff in a company that is not a demo, and they fail closed if storage is unavailable.
- **Staff-assignable** features are denied to non-staff organizations.

Overrides are read once per request, through React `cache`. Every override change is written to `permission_audit_events`.

## 8.4 Organizations and data separation

- **Tenancy model.** All companies share one D1 database, and separation is at row level. The organization always comes from the session (`requireOrg(user)` in `src/lib/org-scope.ts`), never from client input.
- **Scoping.** Scoping is explicit in every query, not a global filter. Tables that carry `organization_id` are filtered directly. Child tables are scoped through their parent project (`inArray` over the company's project ids) or checked after they are fetched (`docs/architecture/multi-tenancy.md`). The architecture standard requires every read of multi-company data to filter in SQL, not in JavaScript.
- **Organization types.** `internal` (a building company), `client` and `demo`. `isStaffOrganizationType` is true for internal and demo.
- **Active organization.** People who belong to several organizations choose one with the `compass-active-org` cookie, limited to their own memberships.
- **Per-company integration state.** Integration state is keyed by organization: drive credentials, overrides, notification settings and bridge queues. The accounting and SMS bridges are pinned to one tenant by configuration (`SAGE_SQUARE_ORGANIZATION_ID`, `SAGE_CONTACT_ORGANIZATION_ID`, `JARVIS_BRIDGE_ORGANIZATION_ID`), and the bridge routes reject work for any other organization.
- **Stronger isolation.** When a company needs physical separation, run it as its own deployment with its own database, the way the demo environment is run. Chapter 10 compares the options.

## 8.5 Project membership

`getProjectAccessRecord` (`src/lib/project-access.ts`) grants access in three cases:

- internal staff whose active organization owns the project and whose role has organization-wide project scope;
- staff previewing a pending invitation (`project_access_invitations.status = sent` for this project);
- a `project_members` row.

In every other case it returns "Project not found", so the project's existence is not revealed.

External participants have a further gate (`src/lib/participant-access.ts`). They must be reviewed, active, identity-matched and an active member. They then get only the capabilities listed for them, such as view or reply to messages, view or respond to POs, comment on or complete to-dos, respond to RFIs or RFQs, and respond to the schedule. Read access never implies write access.

## 8.6 Owner and vendor visibility

There are two audiences (`src/lib/project-audience-access.ts`):

- `owner`: the client and owner project roles;
- `sub_vendor`: subcontractors and suppliers.

Records carry their own visibility, and the server filters reads by the viewer's audience:

| Record | Visibility rule |
|---|---|
| Documents | `visible_to_owner` and `visible_to_sub_vendor` flags |
| Photos | `owner_visible`, `sub_vendor_visible` and `public_shareable` flags |
| Schedule | Published snapshots, with owner and vendor visibility per task |
| Change orders | Audience plus published status |
| Pay applications | `owner_visible` after billing |
| RFIs | Audience column |
| Budget | `src/lib/project-budget-audience.ts` |

**Preview.** Staff with `project-audience-preview` can view a project as a specific owner or vendor. The scope travels in the URL; middleware strips any header a caller supplies and refuses non-GET API calls. Server actions refuse writes while a preview is active (`assertAudiencePreviewWriteAllowed`), and each preview visit is audited.

## 8.7 Demo and read-only mode

- **Demo deployment.** The public demo is a separate deployment (`env.demo`) with its own database and no crons, accounting, payments, external-agent or correspondence connections. It holds only the fictional Summit Ridge Builders data.
- **Demo user and organization.** Inside any deployment, a fixed demo user and organization (`src/lib/demo.ts`) are read-only. `resolveUserContext` returns `DEMO_READ_ONLY` for every mutation, and many domain functions check again. The demo is also denied drive provisioning, user management, the registry, video calls and project creation.
- **`/demo` cookie.** The `/demo` entry cookie is honored only when the development fallback is allowed (local or E2E without an identity provider). In production it is removed and the visitor is redirected to sign in.

## 8.8 Public routes and machine authentication

Public paths are listed in `src/lib/public-paths.ts`. Each one must authenticate itself.

| Class | Examples | Mechanism |
|---|---|---|
| Sign-in pages | `/login`, `/callback`, `/api/auth/*` | Identity-provider flow |
| Scheduled jobs | `/api/operations/*` (exact allowlist) | HMAC-SHA256 over `timestamp.METHOD.path.body` with `JARVIS_BRIDGE_SECRET` (and an optional secondary for rotation), ±300 s skew, 64 KB body, constant-time compare (`src/lib/jarvis/auth.ts`) |
| Inbound mail sync | `/api/email/gmail-sync` | Bearer `COMPASS_EMAIL_SYNC_SECRET` |
| Accounting bridge | `/api/integrations/sage/*` | HMAC with request id plus a stored nonce (section 7.1) |
| Webhooks | Payments, e-sign, SMS | Provider signature or shared secret |
| Token links | `/quote/[token]`, `/vendor-docs/*`, `/ecard/[token]` | Hashed single-purpose token checked by the page |
| Print copy | `/print/record-copy` | Signed 5-minute single-record token |
| Agent and MCP | `/api/compass/*`, `/api/bridge/*` | Agent key, or hashed API key |

**Known gaps to fix.** These are also listed in chapter 12:

- The scheduled-job signature has no nonce, so a captured request could be replayed within the 5-minute window.
- The SMS webhook secret and the e-sign signature arrive in the query string and can appear in access logs.
- Routes under the `/api/google/*` and `/api/netsuite/*` prefixes are public by prefix, so every new route there must call `getCurrentUser()` itself.

## 8.9 Secrets: where they live

| Place | What | Notes |
|---|---|---|
| Cloudflare worker secrets | Names in `wrangler.jsonc` `secrets.required` (Appendix C) | Set with `wrangler secret put`; never in git |
| `wrangler.jsonc` `vars` | Non-secret switches and public identifiers | Reviewed in PRs |
| `.dev.vars` / `.env.local` | Local development | Git-ignored; both files hold the same content |
| Bridge host (Linux) | Bridge HMAC secrets, read-only accounting SQL login, payment tokens | Injected by the host's secret broker at process start |
| Accounting PC (Windows) | Bridge secret, accounting API user, SQL connection | Machine environment variables; moving them to a credential vault is recommended |
| GitHub Actions | Smoke-test account | `PLAYWRIGHT_SMOKE_EMAIL`, `PLAYWRIGHT_SMOKE_PASSWORD` |

**Encryption at rest.** `src/lib/crypto.ts` uses AES-256-GCM with a random 12-byte IV, and derives the key with PBKDF2-SHA256 (100,000 iterations) from an environment secret plus a salt for each purpose. It protects:

- workspace service-account keys (`GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY`);
- calendar and video OAuth tokens (`GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`, with a per-user salt);
- social tokens (`SOCIAL_TOKEN_ENCRYPTION_KEY`);
- legacy ERP tokens (`NETSUITE_TOKEN_ENCRYPTION_KEY`);
- AI provider keys (`PROVIDER_KEY_ENCRYPTION_KEY`).

MCP keys are stored only as hashes.

**Logging.** Scheduled-job and bridge code logs only error classes and HTTP statuses, never payloads, SQL or driver messages.
