import { and, eq, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectBudgetApplications, projectBudgetLines } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The budget domain store: the only code that inserts, updates or deletes
 * project_budget_applications (owner pay applications and contract budget
 * projections) and project_budget_lines (their G703 lines) (architecture
 * standard, section 1).
 *
 * `*Statement` builds an unexecuted statement for `db.batch`; the plain form
 * runs it. Callers pass the same `where` conditions they used before, so the
 * SQL is unchanged. No access rules here; callers check access first.
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

type ApplicationInsert = typeof projectBudgetApplications.$inferInsert
type ApplicationPatch = SQLiteUpdateSetSource<typeof projectBudgetApplications>
type LineInsert = typeof projectBudgetLines.$inferInsert
type LinePatch = SQLiteUpdateSetSource<typeof projectBudgetLines>

/** Contract budget projections ("budget view" rows) are kept under this source. */
const PROJECTION_SOURCE = "compass_contract_budget_projection"

// ---- projectBudgetApplications

export function insertBudgetApplicationStatement(db: Db, values: ApplicationInsert): Statement {
  return db.insert(projectBudgetApplications).values(values)
}

export async function insertBudgetApplication(db: Db, values: ApplicationInsert): Promise<void> {
  await db.insert(projectBudgetApplications).values(values)
}

export function updateBudgetApplicationsStatement(db: Db, where: SQL | undefined, patch: ApplicationPatch): Statement {
  return db.update(projectBudgetApplications).set(patch).where(where)
}

export async function updateBudgetApplications(db: Db, where: SQL | undefined, patch: ApplicationPatch): Promise<void> {
  await db.update(projectBudgetApplications).set(patch).where(where).run()
}

export function deleteBudgetApplicationsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectBudgetApplications).where(where)
}

/**
 * Retires the project's current contract budget projection. Batched with
 * activating the next one (`activateBudgetProjectionStatement`).
 */
export function supersedeCurrentBudgetProjectionStatement(db: Db, projectId: string, now: string): Statement {
  return db
    .update(projectBudgetApplications)
    .set({ status: "budget_superseded", updatedAt: now })
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.status, "budget_current"),
        eq(projectBudgetApplications.sourceSystem, PROJECTION_SOURCE)
      )
    )
}

/** Makes one projection the current, owner-visible contract budget. */
export function activateBudgetProjectionStatement(db: Db, projectionId: string, now: string): Statement {
  return db
    .update(projectBudgetApplications)
    .set({ status: "budget_current", ownerVisible: true, updatedAt: now })
    .where(eq(projectBudgetApplications.id, projectionId))
}

// ---- projectBudgetLines

export function insertBudgetLinesStatement(db: Db, values: LineInsert | readonly LineInsert[]): Statement {
  return isRows(values) ? db.insert(projectBudgetLines).values([...values]) : db.insert(projectBudgetLines).values(values)
}

/** Inserts rows as given; callers keep each call under D1's bound-parameter cap (chunkD1Rows). */
export async function insertBudgetLines(db: Db, values: readonly LineInsert[]): Promise<void> {
  await db.insert(projectBudgetLines).values([...values])
}

export function updateBudgetLinesStatement(db: Db, where: SQL | undefined, patch: LinePatch): Statement {
  return db.update(projectBudgetLines).set(patch).where(where)
}

export async function updateBudgetLines(db: Db, where: SQL | undefined, patch: LinePatch): Promise<void> {
  await db.update(projectBudgetLines).set(patch).where(where).run()
}

export function deleteBudgetLinesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectBudgetLines).where(where)
}

// ---- both tables

/** Removes a pay application and its lines (lines first), one statement at a time. */
export async function discardBudgetApplication(db: Db, applicationId: string): Promise<void> {
  await db.delete(projectBudgetLines).where(eq(projectBudgetLines.applicationId, applicationId))
  await db.delete(projectBudgetApplications).where(eq(projectBudgetApplications.id, applicationId))
}

function isRows<T>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

type BoundValue = string | number | null

/**
 * A Sage pay application imported from a read snapshot, as raw D1 statements
 * so the ingest commits it in one batch with its snapshot and run rows. The
 * values bind in column order (SQL unchanged from the ingest).
 */
export function sageSnapshotApplicationInsertStatement(
  database: D1Database,
  values: readonly BoundValue[],
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_budget_applications (
        id, project_id, source_system, source_record_id,
        application_number, period_to, status,
        original_contract_sum, net_changes, contract_sum_to_date,
        total_completed_stored_to_date, retainage_held,
        total_earned_less_retainage, previous_certificates,
        current_payment_due, balance_to_finish, owner_visible,
        sync_status, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, 'sage_read_snapshot', ?, ?, ?, 'imported_draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced', ?, ?, ?)`,
    )
    .bind(...values)
}

export function sageSnapshotBudgetLineInsertStatement(
  database: D1Database,
  values: readonly BoundValue[],
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO project_budget_lines (
          id, project_id, application_id, source_system, source_record_id,
          source_record_number, cost_code, csi_division, csi_division_name,
          description, original_estimate, prior_changes, current_changes,
          total_changes, adjusted_estimate, prior_costs, current_costs,
          total_costs, percent_complete, balance_to_finish, retainage_held,
          owner_visible, sort_order, sync_status, last_synced_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'sage_read_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'synced', ?, ?, ?)`,
    )
    .bind(...values)
}
