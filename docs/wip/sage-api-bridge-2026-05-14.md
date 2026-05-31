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

This is intentionally not yet a live SQL query from the page. The next implementation step is a dedicated server-only Sage import runner that uses these same config keys, reads Sage, then updates Compass read-model tables.
