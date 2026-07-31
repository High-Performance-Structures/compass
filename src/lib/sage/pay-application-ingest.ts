import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  sagePayApplicationSnapshots,
  sagePayApplicationSyncRuns,
} from "@/db/schema-sage"
import {
  hashSagePayApplicationSnapshot,
  normalizeSagePayApplicationSnapshot,
  reconcileSagePayApplicationSnapshot,
  sagePayApplicationSnapshotSchema,
  type SagePayApplicationSnapshot,
} from "@/lib/sage/pay-application-snapshot"
import { validateSageSyncClaim } from "@/lib/sage/sync-claim"

export type SagePayApplicationIngestResult =
  | {
      readonly success: true
      readonly status: "completed" | "needs_review"
      readonly snapshotId: string
      readonly replayed: boolean
    }
  | { readonly success: false; readonly error: string }

function sameJob(
  run: {
    readonly sageJobId: string | null
    readonly sageJobNumber: string | null
  },
  snapshot: SagePayApplicationSnapshot
): boolean {
  const header = snapshot.header
  const comparisons: boolean[] = []
  if (run.sageJobId && header.sageJobId) {
    comparisons.push(run.sageJobId.trim() === header.sageJobId.trim())
  }
  if (run.sageJobNumber && header.sageJobNumber) {
    comparisons.push(
      run.sageJobNumber.trim().toUpperCase() ===
        header.sageJobNumber.trim().toUpperCase()
    )
  }
  return comparisons.length > 0 && comparisons.every(Boolean)
}

function percentComplete(total: number, adjusted: number): number {
  if (adjusted <= 0) return 0
  return Math.round((total / adjusted) * 1000) / 10
}

async function markRun(
  env: CloudflareEnv,
  runId: string,
  claimToken: string,
  input: {
    readonly status: "completed" | "needs_review" | "failed"
    readonly snapshotId?: string
    readonly sourceApplicationId?: string
    readonly sourceRevision?: string
    readonly sourceHash?: string
    readonly reconciliationJson?: string
    readonly errorMessage?: string
    readonly capturedAt?: string
  }
): Promise<void> {
  const now = new Date().toISOString()
  const db = getDb(env.DB)
  await db
    .update(sagePayApplicationSyncRuns)
    .set({
      status: input.status,
      snapshotId: input.snapshotId ?? null,
      sourceApplicationId: input.sourceApplicationId ?? null,
      sourceRevision: input.sourceRevision ?? null,
      sourceHash: input.sourceHash ?? null,
      reconciliationJson: input.reconciliationJson ?? null,
      errorMessage: input.errorMessage ?? null,
      capturedAt: input.capturedAt ?? null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(sagePayApplicationSyncRuns.id, runId),
        eq(sagePayApplicationSyncRuns.status, "processing"),
        eq(sagePayApplicationSyncRuns.claimToken, claimToken)
      )
    )
}

async function acquireRunForIngestion(
  env: CloudflareEnv,
  runId: string,
  claimToken: string,
  claimedAt: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    `UPDATE sage_pay_application_sync_runs
     SET status = 'processing', claimed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running'
       AND claim_token = ? AND claimed_at = ?`
  )
    .bind(now, now, runId, claimToken, claimedAt)
    .run()
  return (result.meta.changes ?? 0) === 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function reviewReason(reconciliationJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(reconciliationJson)
    if (!isRecord(parsed)) return "Sage pay application totals require review."
    if (parsed.revisionConflict !== null) {
      return "Sage returned changed data without a new source revision."
    }
    return parsed.passed === true
      ? null
      : "Sage pay application totals require review."
  } catch {
    return "Stored Sage reconciliation data requires review."
  }
}

function terminalRunStatement(
  env: CloudflareEnv,
  input: {
    readonly runId: string
    readonly projectId: string
    readonly claimToken: string
    readonly status: "completed" | "needs_review"
    readonly snapshotId: string
    readonly sourceApplicationId: string
    readonly sourceRevision: string
    readonly sourceHash: string
    readonly reconciliationJson: string
    readonly errorMessage: string | null
    readonly capturedAt: string
    readonly now: string
  }
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE sage_pay_application_sync_runs
     SET status = ?, snapshot_id = ?, source_application_id = ?,
         source_revision = ?, source_hash = ?, reconciliation_json = ?,
         error_message = ?, captured_at = ?, completed_at = ?,
         updated_at = ?
     WHERE id = ? AND project_id = ?
       AND status = 'processing' AND claim_token = ?`
  ).bind(
    input.status,
    input.snapshotId,
    input.sourceApplicationId,
    input.sourceRevision,
    input.sourceHash,
    input.reconciliationJson,
    input.errorMessage,
    input.capturedAt,
    input.now,
    input.now,
    input.runId,
    input.projectId,
    input.claimToken
  )
}

function snapshotInsertStatement(
  env: CloudflareEnv,
  input: {
    readonly snapshotId: string
    readonly projectId: string
    readonly sourceHash: string
    readonly snapshot: SagePayApplicationSnapshot
    readonly reconciliationJson: string
    readonly now: string
  }
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sage_pay_application_snapshots (
      id, run_id, project_id, source_application_id, source_revision,
      source_hash, application_number, period_to, row_count, header_json,
      lines_json, reconciliation_json, captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.snapshotId,
    input.snapshot.runId,
    input.projectId,
    input.snapshot.header.sourceApplicationId,
    input.snapshot.header.sourceRevision,
    input.sourceHash,
    input.snapshot.header.applicationNumber,
    input.snapshot.header.periodTo,
    input.snapshot.lines.length,
    JSON.stringify(input.snapshot.header),
    JSON.stringify(input.snapshot.lines),
    input.reconciliationJson,
    input.snapshot.capturedAt,
    input.now
  )
}

export async function ingestSagePayApplicationSnapshot(
  env: CloudflareEnv,
  input: unknown
): Promise<SagePayApplicationIngestResult> {
  const parsed = sagePayApplicationSnapshotSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: "Invalid Sage pay application snapshot." }
  }

  const snapshot = normalizeSagePayApplicationSnapshot(parsed.data)
  const db = getDb(env.DB)
  const run = await db
    .select()
    .from(sagePayApplicationSyncRuns)
    .where(eq(sagePayApplicationSyncRuns.id, snapshot.runId))
    .limit(1)
    .get()

  if (!run) return { success: false, error: "Sage sync run not found." }
  const claim = validateSageSyncClaim(run, snapshot.claimToken)
  if (!claim.success) return claim
  if (
    !claim.terminalReplay &&
    (!run.claimedAt ||
      !(await acquireRunForIngestion(
        env,
        run.id,
        snapshot.claimToken,
        run.claimedAt
      )))
  ) {
    return {
      success: false,
      error: "Sage sync claim was superseded before ingestion.",
    }
  }
  if (!sameJob(run, snapshot)) {
    await markRun(env, run.id, snapshot.claimToken, {
      status: "failed",
      errorMessage: "Sage job identity did not match the queued project.",
    })
    return {
      success: false,
      error: "Sage job identity did not match the queued project.",
    }
  }

  const sourceHash = await hashSagePayApplicationSnapshot(snapshot)
  if (run.snapshotId) {
    const priorRunSnapshot = await db
      .select({
        id: sagePayApplicationSnapshots.id,
        sourceHash: sagePayApplicationSnapshots.sourceHash,
        reconciliationJson: sagePayApplicationSnapshots.reconciliationJson,
      })
      .from(sagePayApplicationSnapshots)
      .where(
        and(
          eq(sagePayApplicationSnapshots.id, run.snapshotId),
          eq(sagePayApplicationSnapshots.projectId, run.projectId)
        )
      )
      .limit(1)
      .get()
    if (!priorRunSnapshot || priorRunSnapshot.sourceHash !== sourceHash) {
      return {
        success: false,
        error: "Sage sync run already captured a different snapshot.",
      }
    }
    const errorMessage = reviewReason(priorRunSnapshot.reconciliationJson)
    return {
      success: true,
      status: errorMessage ? "needs_review" : "completed",
      snapshotId: priorRunSnapshot.id,
      replayed: true,
    }
  }

  const exact = await db
    .select({
      id: sagePayApplicationSnapshots.id,
      reconciliationJson: sagePayApplicationSnapshots.reconciliationJson,
    })
    .from(sagePayApplicationSnapshots)
    .where(
      and(
        eq(sagePayApplicationSnapshots.projectId, run.projectId),
        eq(
          sagePayApplicationSnapshots.sourceApplicationId,
          snapshot.header.sourceApplicationId
        ),
        eq(
          sagePayApplicationSnapshots.sourceRevision,
          snapshot.header.sourceRevision
        ),
        eq(sagePayApplicationSnapshots.sourceHash, sourceHash)
      )
    )
    .limit(1)
    .get()

  if (exact) {
    const errorMessage = reviewReason(exact.reconciliationJson)
    const replayStatus = errorMessage ? "needs_review" : "completed"
    await markRun(env, run.id, snapshot.claimToken, {
      status: replayStatus,
      snapshotId: exact.id,
      sourceApplicationId: snapshot.header.sourceApplicationId,
      sourceRevision: snapshot.header.sourceRevision,
      sourceHash,
      reconciliationJson: exact.reconciliationJson,
      errorMessage: errorMessage ?? undefined,
      capturedAt: snapshot.capturedAt,
    })
    return {
      success: true,
      status: replayStatus,
      snapshotId: exact.id,
      replayed: true,
    }
  }

  const priorRevision = await db
    .select({
      id: sagePayApplicationSnapshots.id,
      sourceHash: sagePayApplicationSnapshots.sourceHash,
    })
    .from(sagePayApplicationSnapshots)
    .where(
      and(
        eq(sagePayApplicationSnapshots.projectId, run.projectId),
        eq(
          sagePayApplicationSnapshots.sourceApplicationId,
          snapshot.header.sourceApplicationId
        ),
        eq(
          sagePayApplicationSnapshots.sourceRevision,
          snapshot.header.sourceRevision
        )
      )
    )
    .limit(1)
    .get()

  const reconciliation = reconcileSagePayApplicationSnapshot(snapshot)
  const reconciliationJson = JSON.stringify({
    ...reconciliation,
    revisionConflict: priorRevision
      ? {
          priorSnapshotId: priorRevision.id,
          priorHash: priorRevision.sourceHash,
          receivedHash: sourceHash,
        }
      : null,
  })
  const snapshotId = `sage-pay-app-snapshot:${run.projectId}:${sourceHash}`
  const now = new Date().toISOString()

  if (!reconciliation.passed || priorRevision) {
    const errorMessage = priorRevision
      ? "Sage returned changed data without a new source revision."
      : "Sage pay application totals require review."
    try {
      await env.DB.batch([
        snapshotInsertStatement(env, {
          snapshotId,
          projectId: run.projectId,
          sourceHash,
          snapshot,
          reconciliationJson,
          now,
        }),
        terminalRunStatement(env, {
          runId: run.id,
          projectId: run.projectId,
          claimToken: snapshot.claimToken,
          status: "needs_review",
          snapshotId,
          sourceApplicationId: snapshot.header.sourceApplicationId,
          sourceRevision: snapshot.header.sourceRevision,
          sourceHash,
          reconciliationJson,
          errorMessage,
          capturedAt: snapshot.capturedAt,
          now,
        }),
      ])
    } catch {
      const raced = await db
        .select({ id: sagePayApplicationSnapshots.id })
        .from(sagePayApplicationSnapshots)
        .where(
          and(
            eq(sagePayApplicationSnapshots.projectId, run.projectId),
            eq(sagePayApplicationSnapshots.sourceHash, sourceHash)
          )
        )
        .limit(1)
        .get()
      if (!raced) {
        await markRun(env, run.id, snapshot.claimToken, {
          status: "failed",
          errorMessage: "Unable to preserve the Sage review snapshot.",
        })
        return {
          success: false,
          error: "Unable to preserve the Sage review snapshot.",
        }
      }
      await markRun(env, run.id, snapshot.claimToken, {
        status: "needs_review",
        snapshotId: raced.id,
        sourceApplicationId: snapshot.header.sourceApplicationId,
        sourceRevision: snapshot.header.sourceRevision,
        sourceHash,
        reconciliationJson,
        errorMessage,
        capturedAt: snapshot.capturedAt,
      })
    }
    return {
      success: true,
      status: "needs_review",
      snapshotId,
      replayed: false,
    }
  }

  const applicationId = `sage-pay-app:${run.projectId}:${sourceHash}`
  const sourceRecordId = [
    snapshot.header.sourceApplicationId,
    snapshot.header.sourceRevision,
    sourceHash,
  ].join(":")
  const statements: D1PreparedStatement[] = [
    snapshotInsertStatement(env, {
      snapshotId,
      projectId: run.projectId,
      sourceHash,
      snapshot,
      reconciliationJson,
      now,
    }),
    env.DB.prepare(
      `INSERT INTO project_budget_applications (
        id, project_id, source_system, source_record_id,
        application_number, period_to, status,
        original_contract_sum, net_changes, contract_sum_to_date,
        total_completed_stored_to_date, retainage_held,
        total_earned_less_retainage, previous_certificates,
        current_payment_due, balance_to_finish, owner_visible,
        sync_status, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, 'sage_read_snapshot', ?, ?, ?, 'imported_draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced', ?, ?, ?)`
    ).bind(
      applicationId,
      run.projectId,
      sourceRecordId,
      snapshot.header.applicationNumber,
      snapshot.header.periodTo,
      snapshot.header.originalContractSum,
      snapshot.header.netChanges,
      snapshot.header.contractSumToDate,
      snapshot.header.totalCompletedStoredToDate,
      snapshot.header.retainageHeld,
      snapshot.header.totalEarnedLessRetainage,
      snapshot.header.previousCertificates,
      snapshot.header.currentPaymentDue,
      snapshot.header.balanceToFinish,
      snapshot.capturedAt,
      now,
      now
    ),
  ]

  for (const line of snapshot.lines) {
    const currentCosts = line.currentWorkCompleted + line.storedMaterials
    statements.push(
      env.DB.prepare(
        `INSERT INTO project_budget_lines (
          id, project_id, application_id, source_system, source_record_id,
          source_record_number, cost_code, csi_division, csi_division_name,
          description, original_estimate, prior_changes, current_changes,
          total_changes, adjusted_estimate, prior_costs, current_costs,
          total_costs, percent_complete, balance_to_finish, retainage_held,
          owner_visible, sort_order, sync_status, last_synced_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'sage_read_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'synced', ?, ?, ?)`
      ).bind(
        `${applicationId}:line:${encodeURIComponent(line.sourceLineId)}`,
        run.projectId,
        applicationId,
        line.sourceLineId,
        line.sourceLineId,
        line.costCode,
        line.csiDivision,
        line.csiDivisionName,
        line.description,
        line.originalEstimate,
        line.priorChanges,
        line.currentChanges,
        line.totalChanges,
        line.adjustedEstimate,
        line.previousWorkCompleted,
        currentCosts,
        line.totalCompletedStoredToDate,
        percentComplete(
          line.totalCompletedStoredToDate,
          line.adjustedEstimate
        ),
        line.balanceToFinish,
        line.retainageHeld,
        line.sortOrder,
        snapshot.capturedAt,
        now,
        now
      )
    )
  }

  statements.push(
    terminalRunStatement(env, {
      runId: run.id,
      projectId: run.projectId,
      claimToken: snapshot.claimToken,
      status: "completed",
      snapshotId,
      sourceApplicationId: snapshot.header.sourceApplicationId,
      sourceRevision: snapshot.header.sourceRevision,
      sourceHash,
      reconciliationJson,
      errorMessage: null,
      capturedAt: snapshot.capturedAt,
      now,
    })
  )

  try {
    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("D1 batch reported an unsuccessful statement.")
    }
  } catch {
    const raced = await db
      .select({ id: sagePayApplicationSnapshots.id })
      .from(sagePayApplicationSnapshots)
      .where(
        and(
          eq(sagePayApplicationSnapshots.projectId, run.projectId),
          eq(sagePayApplicationSnapshots.sourceHash, sourceHash)
        )
      )
      .limit(1)
      .get()
    if (raced) {
      await markRun(env, run.id, snapshot.claimToken, {
        status: "completed",
        snapshotId: raced.id,
        sourceApplicationId: snapshot.header.sourceApplicationId,
        sourceRevision: snapshot.header.sourceRevision,
        sourceHash,
        reconciliationJson,
        capturedAt: snapshot.capturedAt,
      })
      return {
        success: true,
        status: "completed",
        snapshotId: raced.id,
        replayed: true,
      }
    }
    await markRun(env, run.id, snapshot.claimToken, {
      status: "failed",
      snapshotId,
      sourceApplicationId: snapshot.header.sourceApplicationId,
      sourceRevision: snapshot.header.sourceRevision,
      sourceHash,
      reconciliationJson,
      errorMessage: "Unable to normalize the Sage snapshot.",
      capturedAt: snapshot.capturedAt,
    })
    return {
      success: false,
      error: "Unable to normalize the Sage snapshot.",
    }
  }

  return {
    success: true,
    status: "completed",
    snapshotId,
    replayed: false,
  }
}
