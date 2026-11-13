import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectBudgetApplications, projectBudgetLines } from "@/db/schema"
import { payApplicationSageChecks, payApplicationSageSyncs } from "@/db/schema-sage"
import { payApplicationShopTicketImports } from "@/db/schema-shop-tickets"
import { batchGuardStatement, chunkD1InsertRows, isBatchGuardFailure } from "@/lib/d1-query"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import {
  COMPASS_DRAW_SOURCE,
  IMPORTED_DRAW_UNBILLED_STATUSES,
  NON_IMPORTED_BILL_SOURCES,
} from "@/lib/domain/financials/rules"
import {
  DEPOSIT_UNCOUNTED_APPLICATION_STATUSES,
  UNSUBMITTED_DRAW_STATUSES,
  type DepositAppliedMode,
} from "@/lib/financials/contract-deposits"
import { PAY_APPLICATION_BILLING_SOURCES, PAY_APPLICATION_SAGE_CHECK_STATUSES, PAY_APPLICATION_SAGE_SYNC_EVENTS } from "@/lib/domain/budget/statuses"
import { payApplicationMachine, type PayApplicationEvent } from "@/lib/domain/budget/pay-application-machine"
import { PAY_APPLICATION_SHOP_TICKET_IMPORT_MODES } from "@/lib/domain/operations/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

/*
 * The budget domain store: the only code that inserts, updates or deletes
 * project_budget_applications (owner pay applications and contract budget
 * projections) and project_budget_lines (their G703 lines), plus
 * pay_application_shop_ticket_imports (what each shop ticket added to a pay
 * application), pay_application_sage_syncs (what each Sage sync did to a
 * pay application) and pay_application_sage_checks (each change in the Sage
 * check of a pay request built in Sage) (architecture standard, section 1).
 *
 * `*Statement` builds an unexecuted statement for `db.batch`; the plain form
 * runs it. Callers pass the same `where` conditions they used before, so the
 * SQL is unchanged. No access rules here; callers check access first.
 *
 * A Compass draw's status changes only through movePayApplicationStatus
 * (./pay-application-machine.ts); the plain updates refuse a status. Its
 * G703 lines change only while it is a draft (draftPayApplicationLines*).
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

type ApplicationInsert = typeof projectBudgetApplications.$inferInsert
/** Every column but status; see movePayApplicationStatus and the projection functions. */
type ApplicationPatch = Omit<SQLiteUpdateSetSource<typeof projectBudgetApplications>, "status">
type LineInsert = typeof projectBudgetLines.$inferInsert
type LinePatch = SQLiteUpdateSetSource<typeof projectBudgetLines>

/** Contract budget projections ("budget view" rows) are kept under this source. */
const PROJECTION_SOURCE = "compass_contract_budget_projection"

// ---- projectBudgetApplications

const APPLICATION_LISTS = { billingSource: PAY_APPLICATION_BILLING_SOURCES }

export function insertBudgetApplicationStatement(db: Db, values: ApplicationInsert): Statement {
  assertListFields("project_budget_applications", [values], APPLICATION_LISTS)
  return db.insert(projectBudgetApplications).values(values)
}

export async function insertBudgetApplication(db: Db, values: ApplicationInsert): Promise<void> {
  await db.insert(projectBudgetApplications).values(values)
}

// A spread or untyped patch can still carry status past the type; refuse it.
function withoutStatus(patch: ApplicationPatch): ApplicationPatch {
  if ("status" in patch) throw new Error("project_budget_applications.status changes only through the budget store's status functions.")
  return patch
}

export function updateBudgetApplicationsStatement(db: Db, where: SQL | undefined, patch: ApplicationPatch): Statement {
  return db.update(projectBudgetApplications).set(withoutStatus(patch)).where(where)
}

export async function updateBudgetApplications(db: Db, where: SQL | undefined, patch: ApplicationPatch): Promise<void> {
  await db.update(projectBudgetApplications).set(withoutStatus(patch)).where(where).run()
}

// ---- Compass draw status (issue #1329)

/** One Compass-built draw of the project, in one of `statuses`. */
function compassDrawIn(projectId: string, applicationId: string, statuses: readonly string[]): SQL | undefined {
  return and(
    eq(projectBudgetApplications.id, applicationId),
    eq(projectBudgetApplications.projectId, projectId),
    eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE),
    inArray(projectBudgetApplications.status, [...statuses]),
  )
}

/** SQL condition: the Compass draw is (still) in one of `statuses`. */
export function compassDrawStatusIs(projectId: string, applicationId: string, statuses: readonly string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM ${projectBudgetApplications} WHERE ${compassDrawIn(projectId, applicationId, statuses)})`
}

/**
 * Moves a Compass draw through `event` (compare-and-set on the event's
 * source states) together with `alongWith`, the statements that belong to
 * the move (its workflow item, say), in one batch: they land only when the
 * move does. Returns false, writing nothing, when the draw was no longer in
 * a source state (someone else moved it first). Run follow-ups such as
 * Activity or a Sage request only after true.
 */
export async function movePayApplicationStatus(
  db: Db,
  input: {
    readonly projectId: string
    readonly applicationId: string
    readonly event: PayApplicationEvent
    /** Other columns written with the status. */
    readonly values?: ApplicationPatch
    /** A further condition on the draw the move needs (no Sage invoice recorded, say). */
    readonly also?: SQL
    readonly alongWith?: readonly Statement[]
  },
): Promise<boolean> {
  const rule = payApplicationMachine.transitions[input.event]
  const where = and(compassDrawIn(input.projectId, input.applicationId, rule.from), input.also)
  try {
    await db.batch([
      batchGuardStatement(db, sql`EXISTS (SELECT 1 FROM ${projectBudgetApplications} WHERE ${where})`, `pay application ${input.event}`),
      db.update(projectBudgetApplications).set({ ...withoutStatus(input.values ?? {}), status: rule.to }).where(where),
      ...(input.alongWith ?? []),
    ])
    return true
  } catch (error) {
    if (isBatchGuardFailure(error)) return false
    throw error
  }
}

/**
 * A batch statement that fails the batch unless the draw is still a draft
 * (and `condition`, when given, still holds). Put it first in a batch that
 * edits a draft's lines, so nothing lands once it went to review.
 */
export function draftPayApplicationGuardStatement(db: Db, projectId: string, applicationId: string, condition?: SQL) {
  const draft = compassDrawStatusIs(projectId, applicationId, ["draft"])
  return batchGuardStatement(db, condition ? sql`(${draft} AND ${condition})` : draft, "draft pay application unchanged")
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

const RECORDED_MODE: DepositAppliedMode = "recorded"
const AUTO_MODE: DepositAppliedMode = "auto"

/**
 * Records a deposit already applied on an imported draw (billed outside
 * Compass), guarded in SQL: the draw is an imported billed draw of the
 * project with no deposit on it yet, and the deposit received still covers
 * the amount after everything already applied (imported, submitted and billed
 * draws, and drafts set by hand; drafts that apply the deposit automatically
 * are recalculated afterwards). Returns false when the guard refused it.
 */
export async function recordImportedDrawDeposit(db: Db, input: {
  readonly projectId: string
  readonly applicationId: string
  readonly cents: number
  readonly now: string
}): Promise<boolean> {
  const { projectId, applicationId, cents, now } = input
  const result = await db
    .update(projectBudgetApplications)
    .set({ depositApplied: cents / 100, depositAppliedMode: RECORDED_MODE, updatedAt: now })
    .where(and(
      eq(projectBudgetApplications.id, applicationId),
      eq(projectBudgetApplications.projectId, projectId),
      notInArray(projectBudgetApplications.sourceSystem, [...NON_IMPORTED_BILL_SOURCES]),
      notInArray(projectBudgetApplications.status, [...IMPORTED_DRAW_UNBILLED_STATUSES]),
      eq(projectBudgetApplications.depositApplied, 0),
      sql`(SELECT COALESCE(SUM(received_amount_cents), 0) FROM project_contract_deposits
            WHERE project_id = ${projectId} AND status = 'received')
        - (SELECT COALESCE(CAST(ROUND(SUM(other.deposit_applied) * 100) AS INTEGER), 0) FROM project_budget_applications AS other
            WHERE other.project_id = ${projectId} AND other.id <> ${applicationId}
              AND other.status NOT IN (${sql.join(DEPOSIT_UNCOUNTED_APPLICATION_STATUSES.map((status) => sql`${status}`), sql`, `)})
              AND NOT (other.status = 'draft' AND other.deposit_applied_mode = 'auto'))
        >= ${cents}`,
    ))
    .run()
  return (result.meta.changes ?? 0) === 1
}

/**
 * Removes a deposit recorded on an imported draw, while no Compass pay
 * application past draft exists (one may already count on it). Returns false
 * when the guard refused it.
 */
export async function undoImportedDrawDeposit(db: Db, input: {
  readonly projectId: string
  readonly applicationId: string
  readonly now: string
}): Promise<boolean> {
  const { projectId, applicationId, now } = input
  const result = await db
    .update(projectBudgetApplications)
    .set({ depositApplied: 0, depositAppliedMode: AUTO_MODE, updatedAt: now })
    .where(and(
      eq(projectBudgetApplications.id, applicationId),
      eq(projectBudgetApplications.projectId, projectId),
      eq(projectBudgetApplications.depositAppliedMode, RECORDED_MODE),
      sql`NOT EXISTS (SELECT 1 FROM project_budget_applications AS later
            WHERE later.project_id = ${projectId} AND later.source_system = ${COMPASS_DRAW_SOURCE}
              AND later.status NOT IN (${sql.join(UNSUBMITTED_DRAW_STATUSES.map((status) => sql`${status}`), sql`, `)}))`,
    ))
    .run()
  return (result.meta.changes ?? 0) === 1
}

// ---- what a draw's lines were when read

/**
 * A fingerprint of a draw's G703 lines: how many, the latest change and the
 * total of their amounts. Any line write changes it (every write stamps
 * updated_at), so a batch planned from the lines can require it unchanged
 * with a fixed number of parameters, however many lines the draw has.
 */
export type BudgetLinesSignature = { readonly count: number; readonly latest: string; readonly total: number }

function linesSignatureColumns() {
  return {
    count: sql<number>`count(*)`,
    latest: sql<string>`COALESCE(MAX(${projectBudgetLines.updatedAt}), '')`,
    total: sql<number>`total(${projectBudgetLines.currentWorkCompleted} + ${projectBudgetLines.storedMaterials} + ${projectBudgetLines.retainageHeld} + ${projectBudgetLines.totalCosts} + ${projectBudgetLines.balanceToFinish})`,
  }
}

export async function readBudgetLinesSignature(db: Db, applicationId: string): Promise<BudgetLinesSignature> {
  const row = await db.select(linesSignatureColumns()).from(projectBudgetLines).where(eq(projectBudgetLines.applicationId, applicationId)).get()
  return { count: Number(row?.count ?? 0), latest: row?.latest ?? "", total: Number(row?.total ?? 0) }
}

/** SQL condition: the draw's lines still have `signature`. */
export function budgetLinesUnchanged(applicationId: string, signature: BudgetLinesSignature): SQL {
  const columns = linesSignatureColumns()
  return sql`(SELECT ${columns.count}, ${columns.latest}, ${columns.total} FROM ${projectBudgetLines} WHERE ${eq(projectBudgetLines.applicationId, applicationId)})
    = (${signature.count}, ${signature.latest}, ${signature.total})`
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

/**
 * Edits lines of a Compass draw only while it is still a draft: the check is
 * part of the write, so an edit racing "Ready for review" can't change the
 * amounts after they were frozen. Returns how many lines changed.
 */
export async function updateDraftPayApplicationLines(
  db: Db,
  input: { readonly projectId: string; readonly applicationId: string; readonly where: SQL | undefined; readonly patch: LinePatch },
): Promise<number> {
  const result = await db
    .update(projectBudgetLines)
    .set(input.patch)
    .where(and(input.where, eq(projectBudgetLines.applicationId, input.applicationId), compassDrawStatusIs(input.projectId, input.applicationId, ["draft"])))
    .run()
  return result.meta.changes ?? 0
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

/** Moves budget lines linked to a merged vendor to the kept vendor. */
export function companyMergeBudgetLineStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "vendor") return []
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE project_budget_lines SET vendor_id = ?, updated_at = ? WHERE vendor_id = ? AND ${guard.sql}`)
    .bind(move.destinationId, move.now, move.sourceId, ...guard.binds)]
}

// ---- payApplicationShopTicketImports

type ShopTicketImportInsert = typeof payApplicationShopTicketImports.$inferInsert
const SHOP_TICKET_IMPORT_LISTS = { mode: PAY_APPLICATION_SHOP_TICKET_IMPORT_MODES }

/** Insert statements for the rows, chunked to D1's bound-parameter limit. */
export function insertShopTicketImportsStatements(db: Db, rows: readonly ShopTicketImportInsert[]): Statement[] {
  assertListFields("pay_application_shop_ticket_imports", rows, SHOP_TICKET_IMPORT_LISTS)
  return chunkD1InsertRows(payApplicationShopTicketImports, rows).map((chunk) => db.insert(payApplicationShopTicketImports).values(chunk))
}

export function deleteShopTicketImportsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(payApplicationShopTicketImports).where(where)
}

// ---- payApplicationSageSyncs

type SageSyncInsert = typeof payApplicationSageSyncs.$inferInsert
const SAGE_SYNC_LISTS = { eventKind: PAY_APPLICATION_SAGE_SYNC_EVENTS }

/** Records what a Sage sync did to a pay application; a repeat of the same event for the same snapshot is ignored. */
export function insertPayApplicationSageSyncStatement(db: Db, values: SageSyncInsert): Statement {
  assertListFields("pay_application_sage_syncs", [values], SAGE_SYNC_LISTS)
  return db.insert(payApplicationSageSyncs).values(values).onConflictDoNothing()
}

const SAGE_CHECK_LISTS = { status: PAY_APPLICATION_SAGE_CHECK_STATUSES }

/** Records a changed Sage check result on a pay application. */
export async function insertPayApplicationSageCheck(db: Db, values: typeof payApplicationSageChecks.$inferInsert): Promise<void> {
  assertListFields("pay_application_sage_checks", [values], SAGE_CHECK_LISTS)
  await db.insert(payApplicationSageChecks).values(values)
}
