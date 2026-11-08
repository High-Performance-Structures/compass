"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { canSendToSage } from "@/lib/sage/sage-send-access"
import { loadEstimateSageExport, loadEstimateSageSource, queueEstimateSageSync, type EstimateSageExportView } from "@/lib/sage/estimate-sync"
import { sageEstimateWritesEnabled } from "@/lib/sage/estimate-write"
import { projectContext } from "@/lib/server/action-context"

/*
 * The accepted estimate's Sage sync on the estimate page: its status, what
 * stopped it, and Send to Sage / Retry for office staff with finance access.
 * Accepting an estimate queues the sync automatically; this is the manual way.
 */

export type EstimateSageSyncState = {
  readonly writesEnabled: boolean
  readonly sageJobNumber: string | null
  readonly export: EstimateSageExportView | null
  readonly notApplicable: string | null
  readonly proposal: {
    readonly lines: readonly {
      readonly costCode: string
      readonly description: string
      readonly amountCents: number
      readonly sageCostCodeName: string | null
      readonly taxable: boolean
    }[]
    readonly totalCents: number
    readonly blockers: readonly string[]
    readonly budgetLineCount: number | null
  } | null
  /** Server-decided: staff may send (or retry) now. */
  readonly canSend: boolean
}

const OFFICE_STAFF_ONLY = "Only office staff with finance access can send estimates to Sage."

export async function getEstimateSageSyncState(projectId: string, estimateId: string): Promise<ActionResult<EstimateSageSyncState>> {
  const context = await projectContext(projectId, { scope: "organization" })
  if (!context.success) return context
  const { db, env, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  const [source, exported] = await Promise.all([
    loadEstimateSageSource(db, { organizationId, projectId, estimateId }),
    loadEstimateSageExport(db, projectId, estimateId),
  ])
  if (!source) return actionFailure("Estimate not found")
  const writesEnabled = sageEstimateWritesEnabled(env)
  const open = exported ? ["queued", "waiting_for_job", "running", "succeeded"].includes(exported.status) : false
  return {
    success: true,
    data: {
      writesEnabled,
      sageJobNumber: source.sageJobNumber,
      export: exported ?? null,
      notApplicable: source.notApplicable,
      proposal: source.plan
        ? {
            lines: source.plan.proposalLines.map((line) => ({
              costCode: line.costCode,
              description: line.description,
              amountCents: line.amountCents,
              sageCostCodeName: line.sageCostCodeName,
              taxable: line.taxable,
            })),
            totalCents: source.plan.proposalTotalCents,
            blockers: source.plan.blockers,
            budgetLineCount: source.plan.budgetLines ? source.plan.budgetLines.length : null,
          }
        : null,
      canSend: writesEnabled && Boolean(source.plan) && !open,
    },
  }
}

/** Sends (or retries) the accepted estimate's Sage sync; guards still flag it instead of sending. */
export async function sendEstimateToSage(projectId: string, estimateId: string): Promise<ActionResult<{ readonly status: string; readonly reason: string | null }>> {
  const context = await projectContext(projectId, { scope: "organization", mutation: true })
  if (!context.success) return context
  const { db, user, organizationId } = context.data
  if (!organizationId) return actionFailure("No active organization")
  if (!canSendToSage(user)) return actionFailure(OFFICE_STAFF_ONLY)
  const result = await queueEstimateSageSync({ db, organizationId, projectId, estimateId, actor: user, automatic: false })
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  if (result.status === "off" || result.status === "skipped") return actionFailure(result.reason)
  return { success: true, data: { status: result.status, reason: result.reason } }
}
