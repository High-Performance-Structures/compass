# Compass Security Plan

Last updated: 2026-05-19

## Purpose

Compass will become a web-facing operations portal for internal staff, owners,
subcontractors, suppliers, Google Workspace documents, and Sage 100 Contractor
records. That is useful only if Compass becomes the guarded front door instead
of a shortcut around existing controls.

The security direction is:

1. Compass may be web-facing.
2. Google Workspace and Sage must remain behind server-side integration
   boundaries.
3. Sage financial writes must require explicit user approval, strong role
   checks, idempotency, and audit logging.
4. Owner and subcontractor views must be scoped by Compass permissions, not by
   direct Drive links or raw Sage access.

## Non-Negotiable Decisions

### Sage is never browser-facing

The browser must not receive Sage SQL credentials, Sage API credentials, direct
Sage connection strings, or unrestricted Sage record payloads. All Sage access
must flow through server-only Compass actions, background jobs, or a private
Sage bridge.

Compass can expose read models derived from Sage, but it should not expose the
Sage connection itself.

### Compass permissions are enforced server-side

Hiding a button is only convenience. It is not security.

Every server action and API route that touches project, Google, Sage, photo,
financial, owner, subcontractor, or agent data must check:

- authenticated user
- active organization
- project membership or project audience assignment
- role/action permission
- data visibility rule
- write approval requirement, when applicable

### Sage writes start as drafts

Sage remains the source of truth for accounting, job cost, purchase orders,
estimates, progress billing, and financial commitments. Compass may prepare
drafts, diffs, and recommendations. Compass should write to Sage only after an
authorized user approves the exact change.

Initial Sage writes should be limited to narrowly-scoped workflows such as
schedule task updates, and financial writes should remain approval-gated.

### Google Drive links are internal by default

Owners and subcontractors should view approved photos and documents through
Compass-controlled displays. Direct Drive folder links are appropriate for
internal users, but external users should not be routed to broad Drive folders
unless the folder itself is intentionally external-facing.

### Agent actions use the same permissions as humans

The Compass agent must not bypass RBAC or integration rules. Agent tools should
operate through server-side permissioned actions. High-impact actions should be
drafted for approval rather than executed silently.

## Role And Audience Model

Compass needs separate permission surfaces for:

- `admin_owner`: full administrative and developer/work-mode visibility
- `secondary_admin`: admin backup with explicitly granted administrative scope
- `project_manager`: project operations, schedule, RFIs/RFQs, owner update
  review, and team coordination
- `assistant_project_manager`: schedule updates, RFIs/RFQs, POs, takeoffs, and
  project coordination
- `project_administrator`: owner communication, weekly updates, bills, and owner
  pay applications
- `field_superintendent`: field communication, deliveries, schedule, onsite
  issues, daily logs, and photo intake
- `field_crew`: field progress, needs, daily log input, and photo input
- `architectural_designer`: design scope, design documents, RFIs, and owner
  coordination as assigned
- `drafter`: assigned design/drafting documents and task context
- `lead_estimator`: estimates, CSI/cost-code scopes, vendor/sub searches, and
  estimating history
- `assistant_estimator`: assigned estimating tasks and vendor/sub context
- `office_manager`: administrative tasks and internal non-project work
- `owner`: assigned project owner view only
- `sub_vendor`: assigned project/subcontractor/vendor view only

These roles should map to Sage permissions as closely as practical. A Compass
role must not grant more Sage capability than the corresponding Sage account or
Sage API security group allows.

## Integration Boundaries

### WorkOS and identity

- Require SSO for production users where possible.
- Enforce MFA through the identity provider for SSO users.
- Use short-lived sessions and secure cookies.
- Separate internal users from owners/subcontractors through organization,
  membership, and project assignment checks.
- Disable or heavily restrict demo/dev fallback behavior in production.

### Sage 100 Contractor

Sage access should be implemented as a server-only bridge:

- no public SQL Server exposure
- no browser-side Sage credentials
- no raw Sage write actions from the UI
- dedicated Sage integration accounts
- least-privilege Sage `API` security groups per company
- read-only bridge by default
- separate credentials for read-only sync, schedule writes, and financial writes
  if Sage supports that separation cleanly
- production writes require Compass approval records and audit entries

Sage security is company-specific, so each Sage company database must be checked
before assuming a permission applies everywhere.

### Google Workspace

Google Workspace access should follow least privilege:

- avoid domain-wide delegation unless there is a clear business need
- grant only the OAuth scopes Compass actually needs
- keep service accounts in dedicated Google Cloud projects
- restrict who can administer service accounts and delegation
- prefer keyless/service-account signing patterns where possible
- never expose service account keys to the browser
- keep Workspace sharing rules as a second enforcement layer

Compass should enforce its own RBAC before calling Google, then let Google
Workspace enforce the impersonated user's Drive permissions.

### Cloudflare and secrets

Production secrets must live in Cloudflare secrets, not checked-in files or
plain configuration variables.

Required production handling:

- use Cloudflare Worker secrets for WorkOS, Google, Sage, OpenRouter, and future
  messaging credentials
- keep `.env*` and `.dev.vars*` gitignored
- declare required secret names where the deployment tooling supports it
- rotate secrets after any suspected exposure
- avoid logging secrets or connection strings

## Sage Write Approval Model

Every Sage write should have this lifecycle:

1. Compass user or agent creates a draft change.
2. Compass calculates a diff from the current Sage-derived read model.
3. Compass validates project scope, role, and action permission.
4. Authorized approver reviews the diff.
5. Approval creates an immutable audit record.
6. Compass sends the write through the Sage bridge with an idempotency key.
7. Compass records Sage success/failure, resulting external ID, and sync status.
8. Compass refreshes the Sage read model and checks for conflicts.

Financial workflows should be especially strict:

- purchase orders
- vendor bills
- owner pay applications
- progress billing
- estimates
- budget changes
- change orders
- payments

These should not become one-click background writes until the approval model,
audit log, and conflict handling are proven.

## Audit Log Requirements

Compass needs a durable audit log before serious production use.

Minimum audit events:

- login and logout
- failed authorization checks
- project access by external audiences
- photo visibility changes
- owner update publish/unpublish/send actions
- Google Drive file create/update/delete/move actions
- Sage read sync runs
- Sage write drafts
- Sage write approvals
- Sage write execution results
- contact assignment and portal access changes
- admin role and permission changes
- agent tool calls that read or change project/Sage/Google data

Audit records should include:

- organization ID
- project ID, when relevant
- actor user ID
- actor role
- action
- target type and target ID
- before/after values for mutations
- request/session context
- external system and external ID, when relevant
- result status
- created timestamp

## Data Classification

Compass should classify project data before exposing it to owners, subs, or
agent tools.

Initial classes:

- `public_marketing`: approved photos/updates that may be shared externally
- `owner_visible`: owner-approved project updates, photos, budget view, schedule
- `sub_vendor_visible`: assigned scope documents, RFIs, schedule items, messages
- `internal`: normal internal project data
- `sensitive_internal`: financials, issues, disputes, insurance, personnel notes
- `restricted_financial`: Sage financial records, bills, pay apps, payments
- `secret`: credentials, tokens, keys, connection strings

Owners and subcontractors should never receive raw `internal`,
`sensitive_internal`, `restricted_financial`, or `secret` data unless a specific
workflow explicitly transforms and approves it for their audience.

## Immediate Implementation Checklist

### Phase 1: Guardrails before more integrations

- Add a generic `audit_events` table and server-side audit helper.
- Add a project-audience permission helper for owner/subcontractor views.
- Add a Sage action permission matrix separate from generic project RBAC.
- Add an explicit `integration_write_approvals` or equivalent table.
- Require approval records before any Sage mutation action can execute.
- Add "read-only by default" enforcement to the Sage bridge config.
- Add production guardrails that disable demo auth fallback outside development.

### Phase 2: Google and photos

- Replace external-owner "all photos" links with Compass-rendered galleries.
- Store photo visibility changes in the audit log.
- Keep direct Drive folder links internal-only unless deliberately shared.
- Review Google OAuth scopes and remove any that are broader than needed.
- Document the exact service account and delegation scopes used for production.

### Phase 3: Sage read/write hardening

- Create dedicated Sage API users/security groups per company.
- Start with read-only sync jobs for jobs, schedules, POs, estimates, and budget
  summaries.
- Add scheduled read sync with conflict and stale-data indicators.
- Add first controlled write workflow for non-financial schedule changes.
- Add financial draft workflows without Sage write execution.
- Add Sage write execution only after approval and audit are in place.

### Phase 4: Agent tool safety

- Route agent reads through existing server actions.
- Add tool-level permission checks for Sage, Google, financials, and owner data.
- Mark destructive/high-impact tools as approval-required.
- Log agent tool calls to the audit log.
- Add "explain what will happen" previews before writes.

## Rollout Gates

Compass should not be production web-facing with Sage write access until these
are complete:

- WorkOS production auth configured with MFA expectations.
- Demo/dev auth fallback disabled in production.
- Cloudflare production secrets configured.
- Sage bridge server-side only.
- Sage bridge read-only by default.
- Audit log table and helper implemented.
- Owner/sub/vendor direct Drive links removed or made internal-only.
- Project/audience permission checks enforced server-side.
- Sage write approval model implemented.
- At least one restore/rollback plan documented for bad sync or bad writes.

## References

- OWASP Top 10 2021: https://owasp.org/Top10/2021/
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Google Workspace domain-wide delegation best practices: https://knowledge.workspace.google.com/admin/apps/domain-wide-delegation-best-practices
- WorkOS MFA guidance: https://workos.com/docs/mfa
- Sage 100 Contractor API security group: https://help-sage100contractor.na.sage.com/Sage100Contractor/US/23_2/Content/Modules/7-Utilities/Setting_up_a_security_group_for_using_the_API.htm
- Sage 100 Contractor security features: https://help-sage100contractor.na.sage.com/Sage100Contractor/US/24_1/Content/Modules/7-Utilities/Security_features_of_Sage_100_Contractor.htm
