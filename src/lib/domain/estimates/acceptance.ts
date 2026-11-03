import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import {
  contractVersionBaseline,
  contractVersionDifference,
  isContractVersionTreatment,
  versionChangeOrderStatements,
  type ContractVersionTreatment,
} from "@/lib/change-orders/contract-version-acceptance"
import { changeOrderExecutionFromEstimate, estimateSupersedeConditions } from "@/lib/change-orders/estimate-execution"
import { executeBaselineReplacement, rebaselineBlockers } from "@/lib/change-orders/rebaseline-store"
import { revalidateEstimate, type EstimateAccess } from "@/lib/domain/estimates/access"
import { limitedText, safeEvidenceUrl } from "@/lib/domain/estimates/rules"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import type {
  ContractVersionAcceptancePreview,
  ProjectEstimateActionResult,
  ProjectEstimateManualAcceptanceInput,
} from "@/lib/domain/estimates/types"
import {
  estimateAcceptanceDate,
  estimateAcceptanceMethodLabel,
  isEstimateAcceptanceEvidenceMimeType,
  isEstimateAcceptanceMethod,
  type EstimateAcceptanceMethod,
} from "@/lib/estimates/manual-acceptance"
import { completePhaseProposal } from "@/lib/estimates/phase-proposals"
import { readEstimateMode } from "@/lib/estimates/numbering"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"

/**
 * Recording a client's acceptance: the estimate becomes the accepted version
 * (superseding older ones), a change-order estimate executes its change
 * order, a phase estimate creates its phase, and the contract budget is
 * rebuilt. A newer version of an accepted contract is either a difference
 * change order or an executed replacement. These revalidate the estimate
 * pages themselves because a partial success has still changed data.
 */

type EstimateRow = typeof projectEstimates.$inferSelect

async function acceptProjectEstimate(input: {
  readonly access: EstimateAccess
  readonly estimate: typeof projectEstimates.$inferSelect
  readonly acceptanceMethod: EstimateAcceptanceMethod
  readonly evidenceUrl: string
  readonly evidenceLabel: string
  readonly acceptanceNote: string | null
  readonly signedAt: string
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
  /** Run in the acceptance batch, e.g. a difference change order. */
  readonly versionChangeOrder: Awaited<ReturnType<typeof versionChangeOrderStatements>> | null
}): Promise<ProjectEstimateActionResult> {
  const now = new Date().toISOString()
  const recordedByName = activityActorName(input.access.user)

  // One-estimate departments have one accepted contractual baseline; with
  // several estimates per job only an older version of the same estimate is
  // replaced. Old versions stay for audit; the switch happens in one batch.
  const mode = await readEstimateMode(input.access.db, input.access.organizationId, input.access.department)
  // A change-order estimate executes its change order (lines, amount and
  // signed document) in the same batch, and leaves the contract estimate alone.
  const changeOrderExecution = input.estimate.changeOrderId
    ? await changeOrderExecutionFromEstimate({
        db: input.access.db,
        estimate: input.estimate,
        signedAt: input.signedAt,
        evidenceUrl: input.evidenceUrl,
        evidenceLabel: input.evidenceLabel,
        actor: { id: input.access.user.id, name: recordedByName, role: input.access.user.role },
        now,
      })
    : []
  await input.access.db.batch([
    updateEstimatesStatement(input.access.db, and(...estimateSupersedeConditions(input.estimate, mode)), {
      status: "superseded",
      updatedAt: now,
    }),
    updateEstimatesStatement(input.access.db, eq(projectEstimates.id, input.estimate.id), {
      status: "accepted",
      foxitStatus: input.foxitStatus,
      foxitEnvelopeId: input.foxitEnvelopeId,
      signaturePackageUrl: input.evidenceUrl,
      signedAt: input.signedAt,
      acceptanceMethod: input.acceptanceMethod,
      acceptanceNote: input.acceptanceNote,
      acceptanceEvidenceLabel: input.evidenceLabel,
      acceptanceRecordedByName: recordedByName,
      acceptedAt: now,
      acceptedBy: input.access.user.id,
      sageStatus: "ready",
      updatedAt: now,
    }),
    ...changeOrderExecution,
    ...(input.versionChangeOrder?.statements ?? []),
  ])

  // A phase estimate creates its family phase and takes its assembly out of
  // the contract estimate; it never builds this job's contract budget.
  if (input.estimate.phaseProposalId) {
    const phase = await completePhaseProposal({
      db: input.access.db,
      estimate: { ...input.estimate, signedAt: input.signedAt },
      actor: { id: input.access.user.id, name: recordedByName, role: input.access.user.role },
      now,
    })
    if (!phase.success) {
      revalidateEstimate(input.estimate.projectId)
      return { success: false, error: `Estimate accepted, but the phase setup needs another try: ${phase.error}` }
    }
  }

  // Several-estimate jobs move on to orders, not a contract budget.
  const budget =
    mode === "multiple" || input.estimate.phaseProposalId
      ? ({ success: true } as const)
      : await rebuildProjectContractBudget({
          db: input.access.db,
          projectId: input.estimate.projectId,
          actorUserId: input.access.user.id,
        })
  if (!budget.success) {
    return {
      success: false,
      error: `Estimate accepted, but the contract budget needs review: ${budget.error}`,
    }
  }

  if (input.access.organizationId) {
    await recordActivityEvent({
      db: input.access.db,
      organizationId: input.access.organizationId,
      projectId: input.estimate.projectId,
      actor: input.access.user,
      category: "financial",
      action: "estimate_client_acceptance_recorded",
      entityType: "project_estimate",
      entityId: input.estimate.id,
      summary: `Recorded client acceptance for ${input.estimate.estimateNumber} via ${estimateAcceptanceMethodLabel(input.acceptanceMethod)}.`,
      metadata: {
        acceptanceMethod: input.acceptanceMethod,
        acceptanceDate: input.signedAt.slice(0, 10),
        estimateTotalCents: input.estimate.estimateTotalCents,
      },
      createdAt: now,
    })
  }

  revalidateEstimate(input.estimate.projectId)
  return { success: true, id: input.estimate.id }
}

async function signaturePendingEstimate(
  access: EstimateAccess,
  projectId: string,
  estimateId: string
): Promise<EstimateRow> {
  const rows = await access.db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.id, estimateId),
        eq(projectEstimates.projectId, projectId)
      )
    )
    .limit(1)
  const estimate = rows[0]
  if (!estimate || estimate.status !== "signature_pending") {
    throw new Error(
      "Send or print the final estimate version for signature before recording acceptance."
    )
  }
  return estimate
}

/** Records a client acceptance signed on paper, by email, or in Foxit awaiting a contract choice. */
export async function recordManualEstimateAcceptance(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  input: ProjectEstimateManualAcceptanceInput
): Promise<ProjectEstimateActionResult> {
  const estimate = await signaturePendingEstimate(access, projectId, estimateId)
  if (!input.attested) {
    throw new Error(
      "Confirm that the document contains the required client and company representative signatures."
    )
  }
  if (
    !isEstimateAcceptanceMethod(input.acceptanceMethod) ||
    input.acceptanceMethod === "foxit"
  ) {
    throw new Error("Choose how the client signed the estimate.")
  }
  // A Foxit-signed version waiting for a contract choice already has its copy.
  const foxitSignedUrl =
    estimate.foxitStatus === "completed" && estimate.signaturePackageUrl?.startsWith("/api/integrations/foxit/")
      ? estimate.signaturePackageUrl
      : null
  const evidenceUrl = safeEvidenceUrl(input.evidenceUrl) ?? foxitSignedUrl
  if (!evidenceUrl) {
    throw new Error("Upload or link the saved signed document.")
  }
  const evidenceLabel =
    limitedText(input.evidenceLabel, "Signed document label", 200, !foxitSignedUrl) ??
    "Completed Foxit estimate"
  const acceptanceNote = limitedText(
    input.acceptanceNote,
    "Acceptance note",
    2_000
  )
  if (!evidenceLabel) {
    throw new Error("Signed document label is required.")
  }

  const signedAt = estimateAcceptanceDate(input.clientAcceptedAt)
  const mode = await readEstimateMode(access.db, access.organizationId, access.department)
  const baseline = await contractVersionBaseline(access.db, estimate, mode)
  if (!baseline) {
    return await acceptProjectEstimate({
      access,
      estimate,
      acceptanceMethod: input.acceptanceMethod,
      evidenceUrl,
      evidenceLabel,
      acceptanceNote,
      signedAt,
      foxitStatus: "not_applicable",
      foxitEnvelopeId: null,
      versionChangeOrder: null,
    })
  }
  // A newer version of an accepted contract never replaces it silently:
  // staff choose, and a change order records the change either way.
  if (!isContractVersionTreatment(input.versionTreatment)) {
    throw new Error("Choose whether this version replaces the contract or becomes a change order.")
  }
  const versionSummary = limitedText(input.versionSummary, "Description of the change", 10_000, true) ?? ""
  return await acceptContractVersion({
    access,
    estimate,
    baseline,
    treatment: input.versionTreatment,
    summary: versionSummary,
    acceptanceMethod: input.acceptanceMethod,
    evidenceUrl,
    evidenceLabel,
    acceptanceNote,
    signedAt,
  })
}

async function acceptContractVersion(input: {
  readonly access: EstimateAccess
  readonly estimate: typeof projectEstimates.$inferSelect
  readonly baseline: typeof projectEstimates.$inferSelect
  readonly treatment: ContractVersionTreatment
  readonly summary: string
  readonly acceptanceMethod: EstimateAcceptanceMethod
  readonly evidenceUrl: string
  readonly evidenceLabel: string
  readonly acceptanceNote: string | null
  readonly signedAt: string
}): Promise<ProjectEstimateActionResult> {
  const { access, estimate, baseline } = input
  // Changing the contract is a change-order approval. Loaded here because
  // the module is server-only and client components import these actions.
  const { requireFeaturePermission } = await import("@/lib/permission-enforcement")
  await requireFeaturePermission(access.user, "change-orders", "approve")
  const actor = { id: access.user.id, name: activityActorName(access.user), role: access.user.role }
  const now = new Date().toISOString()
  const difference = await contractVersionDifference(access.db, baseline, estimate)
  const changeOrder = await versionChangeOrderStatements(access.db, {
    projectId: estimate.projectId,
    treatment: input.treatment,
    baseline,
    replacement: estimate,
    difference,
    summary: input.summary,
    signedAt: input.signedAt,
    evidenceUrl: input.evidenceUrl,
    evidenceLabel: input.evidenceLabel,
    actor,
    now,
  })

  if (input.treatment === "difference_change_order") {
    return acceptProjectEstimate({
      access,
      estimate,
      acceptanceMethod: input.acceptanceMethod,
      evidenceUrl: input.evidenceUrl,
      evidenceLabel: input.evidenceLabel,
      acceptanceNote: input.acceptanceNote,
      signedAt: input.signedAt,
      foxitStatus: "not_applicable",
      foxitEnvelopeId: null,
      versionChangeOrder: changeOrder,
    })
  }

  const blockers = await rebaselineBlockers(access.db, {
    projectId: estimate.projectId,
    changeOrderId: null,
    ownerAudience: true,
    baseline,
    replacement: estimate,
  })
  if (blockers.length > 0) {
    throw new Error(`This version can't replace the contract yet: ${blockers.join(" ")}`)
  }
  const executed = await executeBaselineReplacement(access.db, {
    projectId: estimate.projectId,
    changeOrder: {
      id: changeOrder.changeOrderId,
      changeOrderNumber: changeOrder.changeOrderNumber,
      baselineEstimateId: baseline.id,
      replacementEstimateId: estimate.id,
    },
    actor,
    acceptance: {
      acceptanceMethod: input.acceptanceMethod,
      acceptanceNote:
        input.acceptanceNote ?? `Replaces v${baseline.versionNumber} through change order ${changeOrder.changeOrderNumber}.`,
      evidenceUrl: input.evidenceUrl,
      evidenceLabel: input.evidenceLabel,
      signedAt: input.signedAt,
      foxitStatus: "not_applicable",
    },
    note: input.acceptanceNote,
    leadingStatements: changeOrder.statements,
  })
  if (!executed.success) return executed

  if (access.organizationId) {
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId: estimate.projectId,
      actor: access.user,
      category: "financial",
      action: "estimate_client_acceptance_recorded",
      entityType: "project_estimate",
      entityId: estimate.id,
      summary: `Recorded client acceptance for ${estimate.estimateNumber} v${estimate.versionNumber}; it replaces v${baseline.versionNumber} through ${changeOrder.changeOrderNumber}.`,
      metadata: {
        acceptanceMethod: input.acceptanceMethod,
        acceptanceDate: input.signedAt.slice(0, 10),
        estimateTotalCents: estimate.estimateTotalCents,
        changeOrderId: changeOrder.changeOrderId,
        netChangeCents: difference.netChangeCents,
      },
      createdAt: now,
    })
  }
  revalidateEstimate(estimate.projectId)
  revalidatePath(`/dashboard/projects/${estimate.projectId}/change-orders`)
  revalidatePath(`/dashboard/projects/${estimate.projectId}/financials`)
  return { success: true, id: estimate.id }
}

/**
 * What accepting this estimate would do to an existing contract: the
 * line-by-line differences, and whether it can replace the contract.
 */
export async function contractVersionAcceptancePreview(
  access: EstimateAccess,
  projectId: string,
  estimateId: string
): Promise<ContractVersionAcceptancePreview> {
  const estimate = await signaturePendingEstimate(access, projectId, estimateId)
  const mode = await readEstimateMode(access.db, access.organizationId, access.department)
  const baseline = await contractVersionBaseline(access.db, estimate, mode)
  if (!baseline) return { replacesContract: false }
  const [difference, replaceBlockers] = await Promise.all([
    contractVersionDifference(access.db, baseline, estimate),
    rebaselineBlockers(access.db, {
      projectId,
      changeOrderId: null,
      ownerAudience: true,
      baseline,
      replacement: estimate,
    }),
  ])
  return {
    replacesContract: true,
    baseline: {
      estimateNumber: baseline.estimateNumber,
      versionNumber: baseline.versionNumber,
      totalCents: difference.previousTotalCents,
    },
    newTotalCents: difference.newTotalCents,
    netChangeCents: difference.netChangeCents,
    lines: difference.lines,
    replaceBlockers,
  }
}

/** The project Drive folder a signed document uploads to, after checking the file. */
export async function acceptanceUploadTarget(
  access: EstimateAccess,
  projectId: string,
  fileName: string,
  mimeType: string
): Promise<{ readonly fileName: string; readonly mimeType: string; readonly folderId: string }> {
  const safeFileName = limitedText(fileName, "File name", 240, true)
  const safeMimeType = limitedText(mimeType, "File type", 160, true)
  if (!safeFileName || !safeMimeType) {
    throw new Error("Choose a signed document to upload.")
  }
  if (!isEstimateAcceptanceEvidenceMimeType(safeMimeType)) {
    throw new Error(
      "Upload the signed document as a PDF, Word document, or image."
    )
  }
  const projectRows = await access.db
    .select({ googleDriveFolderId: projects.googleDriveFolderId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const googleDriveFolderId = projectRows[0]?.googleDriveFolderId
  if (!googleDriveFolderId) {
    throw new Error(
      "Connect the project Google Drive folder before uploading the signed document."
    )
  }
  return { fileName: safeFileName, mimeType: safeMimeType, folderId: googleDriveFolderId }
}
