import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { projects, users } from "@/db/schema"
import { projectContractBudgetRevisions, projectEstimateLineCostItems, projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { sageClientProjectWriteOperations, sageEstimateExports, sageJobProposalReads } from "@/db/schema-sage"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { getCloudflareContext } from "@/lib/db"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import { BUILDER_FEE_NAMES } from "@/lib/domain/financials/builder-fee-codes"
import { planSageEstimate, type SageEstimatePlan } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
import {
  exportsStoppedForJobEstimateIds,
  exportsStoppedForJobWhere,
  updateSageEstimateExportsStatement,
  upsertSageEstimateExport,
} from "@/lib/domain/sage-bridge/estimate-store"
import { SAGE_JOB_MISSING_ESTIMATE_REASON, SAGE_JOB_MISSING_ESTIMATE_REASONS } from "@/lib/domain/sage-bridge/project-send-rules"
import type { SageEstimateExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { requeueFailedSageClientProjectWriteStatement } from "@/lib/domain/sage-bridge/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { indexSageCatalog, mapToSageCostCode } from "@/lib/financials/sage-export-codes"
import { formatCents } from "@/lib/format"
import { sageClientProjectWritesEnabled } from "@/lib/sage/client-project-write"
import { sageEstimateWritePayload, sageEstimateWritesEnabled, type SageEstimateWritePayload } from "@/lib/sage/estimate-write"
import type { Db } from "@/lib/server/action-context"

/*
 * Accepted estimate → Sage: the job (created first through the existing job
 * write when Sage doesn't have it), then the proposal (one line per estimate
 * line, as it flows into the contract, plus the builder fees), then the
 * budget when the company sends it. Queued automatically on
 * acceptance (Settings > Workflows > Sage estimates) or by staff with Retry.
 * Guards stop it with "Needs attention" instead of sending something wrong.
 */

export type EstimateSageSource = {
  readonly estimate: { readonly id: string; readonly estimateNumber: string; readonly status: string; readonly projectId: string }
  readonly sageJobNumber: string | null
  readonly sageJobId: string | null
  readonly plan: SageEstimatePlan | null
  /** Why there's nothing to send (not a contract estimate, no contract budget). */
  readonly notApplicable: string | null
}

/** The accepted estimate's proposal plan from its current contract budget. */
export async function loadEstimateSageSource(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly estimateId: string }
): Promise<EstimateSageSource | null> {
  const [estimate, project] = await Promise.all([
    db
      .select({
        id: projectEstimates.id,
        projectId: projectEstimates.projectId,
        estimateNumber: projectEstimates.estimateNumber,
        status: projectEstimates.status,
        changeOrderId: projectEstimates.changeOrderId,
        phaseProposalId: projectEstimates.phaseProposalId,
        overheadCents: projectEstimates.overheadCents,
        marginCents: projectEstimates.marginCents,
        contingencyCents: projectEstimates.contingencyCents,
      })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.id, input.estimateId), eq(projectEstimates.projectId, input.projectId)))
      .get(),
    db
      .select({ sageJobNumber: projects.sageJobNumber, sageJobId: projects.sageJobId })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
      .get(),
  ])
  if (!estimate || !project) return null
  const sageJobNumber = project.sageJobNumber?.trim() || null
  const base = {
    estimate: { id: estimate.id, estimateNumber: estimate.estimateNumber, status: estimate.status, projectId: estimate.projectId },
    sageJobNumber,
    sageJobId: project.sageJobId?.trim() || null,
  }
  if (estimate.status !== "accepted") return { ...base, plan: null, notApplicable: "The estimate isn't accepted." }
  if (estimate.changeOrderId || estimate.phaseProposalId) {
    return { ...base, plan: null, notApplicable: "Change-order and phase estimates go to Sage with their change order or phase." }
  }
  const revision = await db
    .select({ id: projectContractBudgetRevisions.id, total: projectContractBudgetRevisions.originalContractSumCents })
    .from(projectContractBudgetRevisions)
    .where(
      and(
        eq(projectContractBudgetRevisions.projectId, input.projectId),
        eq(projectContractBudgetRevisions.acceptedEstimateId, estimate.id),
        eq(projectContractBudgetRevisions.status, "current")
      )
    )
    .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
    .get()
  if (!revision) return { ...base, plan: null, notApplicable: "The estimate has no contract budget to send." }

  const [lines, taxableItems, catalog, settings, proposal] = await Promise.all([
    db
      .select({
        id: projectEstimateLines.id,
        costCode: projectEstimateLines.costCode,
        costCodeName: projectEstimateLines.costCodeName,
        divisionCode: projectEstimateLines.divisionCode,
        description: projectEstimateLines.description,
        amountCents: projectEstimateLines.lineTotalCents,
        costCents: projectEstimateLines.directCostCents,
        sortOrder: projectEstimateLines.sortOrder,
        taxable: projectEstimateLines.taxable,
        taxName: projectEstimateLines.taxName,
        taxRateBasisPoints: projectEstimateLines.taxRateBasisPoints,
      })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.projectId, input.projectId), eq(projectEstimateLines.estimateId, estimate.id))),
    db
      .select({
        estimateLineId: projectEstimateLineCostItems.estimateLineId,
        taxName: projectEstimateLineCostItems.taxName,
        taxRateBasisPoints: projectEstimateLineCostItems.taxRateBasisPoints,
      })
      .from(projectEstimateLineCostItems)
      .where(
        and(
          eq(projectEstimateLineCostItems.estimateId, estimate.id),
          eq(projectEstimateLineCostItems.taxable, true),
          isNull(projectEstimateLineCostItems.deletedAt)
        )
      ),
    loadProjectCostCodeCatalog(db),
    readFeatureSettings(db, input.organizationId, "sage-estimates"),
    db.select().from(sageJobProposalReads).where(eq(sageJobProposalReads.projectId, input.projectId)).get(),
  ])
  // A line is taxable when it is, or when any of its cost items is (its first taxable item names the tax).
  const taxableItemByLine = new Map<string, (typeof taxableItems)[number]>()
  for (const item of taxableItems) if (!taxableItemByLine.has(item.estimateLineId)) taxableItemByLine.set(item.estimateLineId, item)
  const index = indexSageCatalog(catalog)
  // The builder fees, as the contract budget files them (in BUILDER_FEE_NAMES order).
  const feeAmounts = [estimate.overheadCents, estimate.marginCents, estimate.contingencyCents]
  const plan = planSageEstimate({
    estimateLines: lines.map((line) => {
      const item = taxableItemByLine.get(line.id)
      const lineTax = line.taxable && line.taxName?.trim()
      return {
        costCode: line.costCode,
        costCodeName: line.costCodeName,
        divisionCode: line.divisionCode,
        description: line.description,
        amountCents: line.amountCents,
        sortOrder: line.sortOrder,
        taxable: line.taxable || Boolean(item),
        taxName: lineTax ? line.taxName : (item?.taxName ?? line.taxName),
        taxRateBasisPoints: lineTax || !item ? line.taxRateBasisPoints : item.taxRateBasisPoints,
      }
    }),
    feeLines: BUILDER_FEE_NAMES.map((costCode, feeIndex) => ({ costCode, amountCents: feeAmounts[feeIndex] ?? 0 })),
    contractTotalCents: revision.total,
    costLines: lines.map((line) => ({ costCode: line.costCode, costCents: line.costCents })),
    sendBudget: settings.sendBudget,
    mapCostCode: (costCode) => mapToSageCostCode(costCode, index),
    // A summary of another Sage job (the project was relinked) doesn't count.
    sageProposal: proposal && proposal.sageJobNumber === sageJobNumber ? { lineCount: proposal.lineCount, totalCents: proposal.totalCents } : null,
  })
  return { ...base, plan, notApplicable: null }
}

/** The estimate's Sage status as staff see it. */
function estimateSageStatus(status: SageEstimateExportStatus): string {
  if (status === "succeeded") return "sent"
  if (status === "waiting_for_job" || status === "running") return "queued"
  return status
}

type JobState =
  | { readonly kind: "linked" }
  | { readonly kind: "waiting" }
  | { readonly kind: "missing"; readonly reason: string }

/** Whether Sage has the job, is about to (the job write), or staff must send it. */
async function ensureSageJob(
  db: Db,
  input: { readonly database: D1Database; readonly jobWritesEnabled: boolean; readonly organizationId: string; readonly projectId: string; readonly sageJobNumber: string | null }
): Promise<JobState> {
  const { organizationId, projectId, sageJobNumber } = input
  if (sageJobNumber) return { kind: "linked" }
  const write = await db
    .select({ id: sageClientProjectWriteOperations.id, status: sageClientProjectWriteOperations.status, payloadJson: sageClientProjectWriteOperations.payloadJson })
    .from(sageClientProjectWriteOperations)
    .where(
      and(
        eq(sageClientProjectWriteOperations.organizationId, organizationId),
        eq(sageClientProjectWriteOperations.projectId, projectId),
        eq(sageClientProjectWriteOperations.operationType, "ensure_client_and_job")
      )
    )
    .get()
  if (write && (write.status === "queued" || write.status === "running")) return { kind: "waiting" }
  if (write?.status === "failed" && input.jobWritesEnabled) {
    // The job write Compass already prepared goes round again (the Overview's Send to Sage).
    const now = new Date().toISOString()
    const result = await requeueFailedSageClientProjectWriteStatement(input.database, {
      operationId: write.id,
      organizationId,
      payloadJson: write.payloadJson,
      now,
    }).run()
    if (result.meta.changes === 1) return { kind: "waiting" }
  }
  return { kind: "missing", reason: SAGE_JOB_MISSING_ESTIMATE_REASON }
}

/**
 * Puts the project's estimate exports that stopped only because Sage didn't
 * have the job back to waiting for the job, for the caller's batch with the
 * job write (Create in Sage, Send to Sage) or the job link. The writer offers
 * them as soon as the project has its Sage job number. Estimates first: their
 * subquery reads the exports before the second statement changes them.
 */
export function estimateExportsFollowJobStatements(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly now: string }
) {
  const where = exportsStoppedForJobWhere({ ...input, reasons: SAGE_JOB_MISSING_ESTIMATE_REASONS })
  return [
    updateEstimatesStatement(
      db,
      and(eq(projectEstimates.projectId, input.projectId), inArray(projectEstimates.id, exportsStoppedForJobEstimateIds(db, where))),
      { sageStatus: estimateSageStatus("waiting_for_job"), updatedAt: input.now }
    ),
    updateSageEstimateExportsStatement(db, where, {
      status: "waiting_for_job",
      claimToken: null,
      errorMessage: null,
      completedAt: null,
      updatedAt: input.now,
    }),
  ] as const
}

export type QueueEstimateSageSyncResult =
  | { readonly status: "off" | "skipped"; readonly reason: string }
  | { readonly status: SageEstimateExportStatus; readonly reason: string | null }

/**
 * Queues an accepted estimate's sync to Sage, or flags what needs attention.
 * Never throws: acceptance must not fail because of Sage.
 */
export async function queueEstimateSageSync(input: {
  readonly db: Db
  readonly organizationId: string | null
  readonly projectId: string
  readonly estimateId: string
  readonly actor: ActivityActor | null
  readonly automatic: boolean
}): Promise<QueueEstimateSageSyncResult> {
  try {
    const { env } = await getCloudflareContext()
    if (!input.organizationId) return { status: "skipped", reason: "No company." }
    if (!sageEstimateWritesEnabled(env)) return { status: "off", reason: "Sending estimates to Sage isn't turned on for this company yet." }
    const { db, organizationId } = input
    if (input.automatic) {
      const settings = await readFeatureSettings(db, organizationId, "sage-estimates")
      if (!settings.autoSync) return { status: "off", reason: "Automatic estimate sync is off in Settings." }
    }
    const source = await loadEstimateSageSource(db, { organizationId, projectId: input.projectId, estimateId: input.estimateId })
    if (!source) return { status: "skipped", reason: "Estimate not found." }
    if (!source.plan) return { status: "skipped", reason: source.notApplicable ?? "Nothing to send." }

    const job = await ensureSageJob(db, {
      database: env.DB,
      jobWritesEnabled: sageClientProjectWritesEnabled(env),
      organizationId,
      projectId: input.projectId,
      sageJobNumber: source.sageJobNumber,
    })
    const blocker = source.plan.blockers[0] ? source.plan.blockers.join(" ") : job.kind === "missing" ? job.reason : null
    const status: Extract<SageEstimateExportStatus, "queued" | "waiting_for_job" | "needs_attention"> = blocker
      ? "needs_attention"
      : job.kind === "waiting"
        ? "waiting_for_job"
        : "queued"
    const now = new Date().toISOString()
    const written = await upsertSageEstimateExport(db, {
      organizationId,
      projectId: input.projectId,
      estimateId: input.estimateId,
      status,
      requestedByUserId: input.actor?.id ?? null,
      automatic: input.automatic,
      errorMessage: blocker,
      now,
    })
    if (!written) return { status: "skipped", reason: "This estimate is already on its way to Sage or in Sage." }
    await updateEstimatesStatement(db, and(eq(projectEstimates.id, input.estimateId), eq(projectEstimates.projectId, input.projectId)), {
      sageStatus: estimateSageStatus(status),
      updatedAt: now,
    })
    if (input.actor) {
      const total = formatCents(source.plan.proposalTotalCents)
      await recordActivityEvent({
        db,
        organizationId,
        projectId: input.projectId,
        actor: input.actor,
        category: "financial",
        action: status === "needs_attention" ? "estimate_sage_sync_needs_attention" : "estimate_sage_sync_queued",
        entityType: "project_estimate",
        entityId: input.estimateId,
        summary:
          status === "needs_attention"
            ? `${source.estimate.estimateNumber}: Sage sync needs attention. ${blocker ?? ""}`.trim()
            : input.automatic
              ? `${source.estimate.estimateNumber}: syncing to Sage automatically (proposal ${source.plan.proposalLines.length} lines, ${total}).`
              : `${source.estimate.estimateNumber}: sent to Sage (proposal ${source.plan.proposalLines.length} lines, ${total}).`,
        metadata: { status, automatic: input.automatic, proposalTotalCents: source.plan.proposalTotalCents },
        createdAt: now,
      })
    }
    return { status, reason: blocker }
  } catch (error) {
    console.error("Estimate Sage sync could not be queued", error)
    return { status: "skipped", reason: "The Sage sync couldn't be queued; use Send to Sage on the estimate." }
  }
}

export type EstimateWriterRequest =
  | { readonly kind: "ready"; readonly payload: SageEstimateWritePayload }
  | { readonly kind: "waiting" }
  | { readonly kind: "needs_attention"; readonly reason: string }

/** Builds the writer request for a claimed export from the estimate as it is now. */
export async function buildEstimateWriterRequest(
  db: Db,
  row: { readonly organizationId: string; readonly projectId: string; readonly estimateId: string }
): Promise<EstimateWriterRequest> {
  const source = await loadEstimateSageSource(db, row)
  if (!source) return { kind: "needs_attention", reason: "The estimate wasn't found." }
  if (!source.plan) return { kind: "needs_attention", reason: source.notApplicable ?? "Nothing to send." }
  if (source.plan.blockers.length > 0) return { kind: "needs_attention", reason: source.plan.blockers.join(" ") }
  if (!source.sageJobNumber) return { kind: "waiting" }
  const payload = sageEstimateWritePayload(source.plan, {
    projectId: row.projectId,
    estimateId: row.estimateId,
    sageJobNumber: source.sageJobNumber,
    sageJobId: source.sageJobId,
  })
  return payload ? { kind: "ready", payload } : { kind: "needs_attention", reason: "The proposal's Sage details aren't complete." }
}

/** The person who queued an export, for the success entry in Activity. */
export async function sageExportActor(db: Db, userId: string | null): Promise<ActivityActor | null> {
  if (!userId) return null
  const user = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  return user ?? null
}

export type EstimateSageExportView = {
  readonly status: SageEstimateExportStatus
  readonly errorMessage: string | null
  readonly requestedAt: string
  readonly completedAt: string | null
  readonly automatic: boolean
}

/** The estimate's current export row, for the estimate page. */
export async function loadEstimateSageExport(db: Db, projectId: string, estimateId: string): Promise<EstimateSageExportView | undefined> {
  return db
    .select({
      status: sageEstimateExports.status,
      errorMessage: sageEstimateExports.errorMessage,
      requestedAt: sageEstimateExports.requestedAt,
      completedAt: sageEstimateExports.completedAt,
      automatic: sageEstimateExports.automatic,
    })
    .from(sageEstimateExports)
    .where(and(eq(sageEstimateExports.projectId, projectId), eq(sageEstimateExports.estimateId, estimateId)))
    .get()
}
