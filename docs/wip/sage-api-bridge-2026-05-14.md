# Sage API Bridge Placement

Last updated: 2026-05-14

## Decision

Compass should treat Sage 100 Contractor as a server-side integration, not as a browser-side API. The Sage bridge should run behind Compass actions/jobs, read from the private Sage SQL Server/API surface, write normalized snapshots into Compass, and expose those snapshots to the dashboard, project pages, and agent tools.

## Why This Fits Compass

Sage remains the source of truth for job financials, job cost, purchase orders, billing, estimates, schedule commitments, staff/sub/supplier assignments, and accounting workflows. Compass becomes the readable operational layer: project cards, owner updates, schedule views, RFI context, photo review, and assistant queries.

The current Compass data model already has the right first landing zones:

- `projects`: canonical Compass project identity plus Sage job IDs/numbers.
- `project_external_links`: cross-system project mapping and sync status.
- `project_operations`: Sage-sourced purchase orders, commitments, and task/notice records.
- `schedule_tasks`: Compass schedule display/edit layer for Sage-owned schedule data.
- Owner update and dashboard actions: consumers of the Sage-derived next schedule item and operational commitments.

## Connection Shape

The prior Sage work established that HPS Sage access is through Sage 100 Contractor backed by SQL Server over the private Tailscale network. The bridge should therefore be configured with secrets, not checked-in values:

- `SAGE_SQL_SERVER`
- `SAGE_SQL_DATABASE`
- `SAGE_SQL_USER`
- `SAGE_SQL_PASSWORD`
- `SAGE_SQL_PORT` optional, default likely `1433`
- `SAGE_SQL_INSTANCE` optional, if a named instance is still used
- `SAGE_SQL_ENCRYPT` optional, depends on the SQL Server certificate setup
- `SAGE_READ_ONLY` defaults to read-only unless explicitly set to `false`
- `SAGE_BRIDGE_SECRET` is a separate HMAC secret shared between Compass and the
  private poller. SQL credentials remain tailnet-only and are never sent to
  Compass.

The live connector should start with read-only sync jobs. Writes back to Sage should require a visible user action, idempotency key, diff/conflict review, and audit log entry.

## First Read Models

The first Sage import should hydrate:

- Jobs/projects by Sage job ID and visible job number.
- Cost codes and phases.
- Purchase orders and committed costs.
- Staff, subcontractor, and supplier task commitments.
- Schedule tasks/milestones/notices if the Sage schedule fields are reliable.
- Progress billing/invoice summaries after read-only job mapping is stable.

Known workflow/table hints from the migration trail:

- Jobs and phases: `actrec` / `jobphs`
- A/P invoice workflows: `acpinv` / `apivln`
- A/R invoice, receipt, and deposit workflows: `acrinv` / `acrpmt` / `actrec`
- Equipment workflow: `eqpmnt`

## Current Compass Implementation

The dashboard now exposes the bridge status from `src/lib/sage/config.ts` through `getDashboardOverview()`. It shows whether the Sage bridge has credentials loaded, whether it is read-only, how many projects are mapped to Sage, how many Sage operation records are in Compass, and the latest recorded Sage operation sync time.

Pay-application/G703 reads use an outbound pull queue:

1. Authorized internal staff select **Sync with Sage** in the project budget.
2. Compass records an idempotent, project-scoped read request.
3. The private poller claims requests with an HMAC-authenticated `GET` to
   `/api/integrations/sage/pay-applications/requests`.
4. The poller reads Sage with least-privilege SQL credentials and posts the
   captured header and lines to
   `/api/integrations/sage/pay-applications/results`.
5. Compass verifies the HMAC, queued job identity, formulas, row identity, and
   revision/hash before normalizing an internal-only G703 application.

The result body is bounded to 1 MiB. Exact replays are idempotent. Changed data
without a changed Sage revision, duplicate line IDs, job mismatches, and total
reconciliation failures cannot replace the current view or become
owner-visible. Owner publication remains a separate reviewed action.

Each poll carries a unique `x-compass-request-id` UUID. The HMAC covers that
request ID together with the timestamp, method, target, and raw body. Compass
consumes poll request IDs once, rejects replayed polls, and only reports the
bridge online after a recent authenticated poll. Production and
non-production environments must use distinct `SAGE_BRIDGE_SECRET` values.

### Private poller deployment

The reference poller is `scripts/sage_pay_application_poller.py`; its systemd
units are in `deploy/systemd/`. The deployed process:

- runs on a private-network bridge host, never in a browser;
- receives the SQL password and HMAC secret from the host secret broker;
- connects with a dedicated read-only Sage identity;
- claims bounded Compass requests once per minute;
- reads only the latest AIA header and its G703 lines;
- derives total earned less retainage from populated Sage header totals when
  Sage's `ttlern` field is empty;
- posts a revisioned, project-scoped snapshot back to Compass; and
- uses a process lock so overlapping timer invocations cannot duplicate work.

Operational installation and health-check commands are documented in
`deploy/systemd/README.md`. Do not place SQL credentials or the shared HMAC
secret in a unit file, command history, repository file, or application log.

### Production validation checklist

Before treating a project as connected:

1. Confirm the Compass project maps both Sage's stable job identity and its
   numeric AIA job key.
2. Request a read from the project Budget / G703 workspace.
3. Confirm the bridge run completes and the heartbeat remains current.
4. Reconcile header contract, completed-and-stored, retainage, prior
   certificates, current payment, and balance totals against Sage.
5. Reconcile the sum and count of normalized G703 lines against the Sage AIA
   lines.
6. Keep the imported application internal until a staff member reviews and
   intentionally publishes it to an owner.
