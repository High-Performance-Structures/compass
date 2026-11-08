/**
 * The only writer of the Sage estimate tables (architecture standard,
 * section 1): accepted estimates queued for Sage (sage_estimate_exports) and
 * the read-only summary of each job's Sage proposal (sage_job_proposal_reads).
 * Writes are fenced by status and claim token in the WHERE clause. No auth
 * here: callers resolve access or verify the bridge signature first.
 */
import { and, eq, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm"

import { sageEstimateExports, sageJobProposalReads } from "@/db/schema-sage"
import { SAGE_ESTIMATE_EXPORT_STATUSES, type SageEstimateExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

const LISTS = { status: SAGE_ESTIMATE_EXPORT_STATUSES }

export type SageEstimateExportRequest = {
  readonly organizationId: string
  readonly projectId: string
  readonly estimateId: string
  readonly status: Extract<SageEstimateExportStatus, "queued" | "waiting_for_job" | "needs_attention">
  readonly requestedByUserId: string | null
  readonly automatic: boolean
  readonly errorMessage: string | null
  readonly now: string
}

/**
 * Queues (or flags) an estimate's sync: a new row, or the estimate's row sent
 * round again. A row the writer is running, or that already succeeded, is
 * left alone; returns whether the row was written.
 */
export async function upsertSageEstimateExport(db: Db, row: SageEstimateExportRequest): Promise<boolean> {
  const values = {
    id: crypto.randomUUID(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    estimateId: row.estimateId,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    automatic: row.automatic,
    requestedAt: row.now,
    errorMessage: row.errorMessage,
    updatedAt: row.now,
  }
  assertListFields("sage_estimate_exports", values, LISTS)
  const written = await db
    .insert(sageEstimateExports)
    .values(values)
    .onConflictDoUpdate({
      target: sageEstimateExports.estimateId,
      set: {
        status: row.status,
        requestedByUserId: row.requestedByUserId,
        automatic: row.automatic,
        requestedAt: row.now,
        claimToken: null,
        claimedAt: null,
        errorMessage: row.errorMessage,
        completedAt: null,
        updatedAt: row.now,
      },
      setWhere: and(
        eq(sageEstimateExports.organizationId, row.organizationId),
        ne(sageEstimateExports.status, "running"),
        ne(sageEstimateExports.status, "succeeded")
      ),
    })
    .returning({ id: sageEstimateExports.id })
  return written.length > 0
}

/** Claims one queued (or stale running) export for the writer; false when another poll got it first. */
export async function claimSageEstimateExport(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await db
    .update(sageEstimateExports)
    .set({
      status: "running",
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageEstimateExports.attemptCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sageEstimateExports.id, input.id),
        eq(sageEstimateExports.organizationId, input.organizationId),
        or(
          eq(sageEstimateExports.status, "queued"),
          eq(sageEstimateExports.status, "waiting_for_job"),
          and(eq(sageEstimateExports.status, "running"), lt(sageEstimateExports.claimedAt, input.staleBefore))
        )
      )
    )
    .returning({ id: sageEstimateExports.id })
  return claimed.length > 0
}

export type SageEstimateExportPatch = {
  readonly status: SageEstimateExportStatus
  readonly payloadJson?: string | null
  readonly claimToken?: string | null
  readonly errorMessage?: string | null
  readonly completedAt?: string | null
  readonly updatedAt: string
}

function exportUpdate(db: Db, where: SQL | undefined, patch: SageEstimateExportPatch) {
  assertListFields("sage_estimate_exports", patch, LISTS)
  return db.update(sageEstimateExports).set(patch).where(where)
}

/** Unexecuted update fenced by the caller's `where` (id plus claim token), for a batch. */
export function updateSageEstimateExportsStatement(
  db: Db,
  where: SQL | undefined,
  patch: SageEstimateExportPatch
): ReturnType<typeof exportUpdate> {
  return exportUpdate(db, where, patch)
}

/** The project's exports stopped only because Sage didn't have the job yet (`reasons` is that text). */
export function exportsStoppedForJobWhere(input: {
  readonly organizationId: string; readonly projectId: string; readonly reasons: readonly string[]
}): SQL | undefined {
  return and(
    eq(sageEstimateExports.organizationId, input.organizationId),
    eq(sageEstimateExports.projectId, input.projectId),
    eq(sageEstimateExports.status, "needs_attention"),
    inArray(sageEstimateExports.errorMessage, [...input.reasons])
  )
}

/** Their estimate ids, as a subquery for the caller's estimate update in the same batch. */
export function exportsStoppedForJobEstimateIds(db: Db, where: SQL | undefined) {
  return db.select({ estimateId: sageEstimateExports.estimateId }).from(sageEstimateExports).where(where)
}

type SageJobProposalRead = {
  readonly projectId: string
  readonly sageJobNumber: string
  readonly lineCount: number
  readonly totalCents: number
  readonly linesJson: string
  readonly capturedAt: string
}

function proposalReadUpsert(db: Db, row: SageJobProposalRead) {
  return db
    .insert(sageJobProposalReads)
    .values(row)
    .onConflictDoUpdate({
      target: sageJobProposalReads.projectId,
      set: {
        sageJobNumber: row.sageJobNumber,
        lineCount: row.lineCount,
        totalCents: row.totalCents,
        linesJson: row.linesJson,
        capturedAt: row.capturedAt,
      },
    })
}

/** Unexecuted upsert of a job's Sage proposal summary, for the reader's batch. */
export function upsertSageJobProposalReadStatement(db: Db, row: SageJobProposalRead): ReturnType<typeof proposalReadUpsert> {
  return proposalReadUpsert(db, row)
}
