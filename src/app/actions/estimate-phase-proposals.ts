"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectChangeOrders } from "@/db/schema"
import {
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimates,
  projectPhaseProposals,
} from "@/db/schema-estimates"
import { projectFamilyPhases } from "@/db/schema-project-families"
import { contractPackets } from "@/db/schema-contracts"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import { estimateAccess, revalidateEstimate } from "@/lib/domain/estimates/access"
import { rfqBidImportsForEstimatesDeleteQueries } from "@/lib/domain/operations/store"
import { estimateTotalsForLines } from "@/lib/domain/estimates/rules"
import {
  copyAssemblyAsPhaseEstimate,
  deleteEstimatesStatement,
  deletePhaseProposalsStatement,
  updateEstimates,
} from "@/lib/domain/estimates/store"
import { isContractEstimate } from "@/lib/estimates/estimate-family"
import {
  completePhaseProposal,
  isPhaseProposalContractRemoval,
  nextPhaseEstimateNumber,
  type PhaseProposalContractRemoval,
} from "@/lib/estimates/phase-proposals"
import { requirePermission } from "@/lib/permissions"

export type PhaseProposalActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type ProjectPhaseProposalSummary = {
  readonly id: string
  readonly phaseName: string
  readonly assemblyName: string
  readonly sourceEstimateNumber: string
  readonly sourceVersionNumber: number
  readonly status: "proposed" | "accepted"
  readonly estimate: {
    readonly id: string
    readonly estimateNumber: string
    readonly versionNumber: number
    readonly status: string
    readonly totalCents: number
  } | null
  readonly familyPhase: { readonly id: string; readonly projectNumber: string | null; readonly projectId: string | null } | null
  readonly contractRemoval: PhaseProposalContractRemoval | null
  readonly deductChangeOrder: { readonly id: string; readonly number: string } | null
  /** Only proposals with nothing out for signature or accepted can be deleted. */
  readonly canDelete: boolean
}

function revalidatePhasePaths(projectId: string): void {
  revalidateEstimate(projectId)
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
}

/**
 * Offers one assembly of the contract estimate as a later phase: a separate
 * estimate with just that assembly, approved on its own. The contract
 * estimate is not changed until the phase estimate is accepted.
 */
export async function exportEstimateAssemblyAsPhase(
  projectId: string,
  estimateId: string,
  assemblyId: string,
  phaseNameInput: string
): Promise<PhaseProposalActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const phaseName = phaseNameInput.trim().slice(0, 200)
    if (!phaseName) throw new Error("Name the phase.")
    const source = await access.db
      .select()
      .from(projectEstimates)
      .where(and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId)))
      .get()
    if (!source || !isContractEstimate(source)) {
      throw new Error("Export a phase from the contract estimate.")
    }
    if (source.status === "superseded" || source.status === "void") {
      throw new Error("Open the current contract estimate to export a phase.")
    }
    const [assembly] = await access.db
      .select()
      .from(projectEstimateAssemblies)
      .where(and(eq(projectEstimateAssemblies.id, assemblyId), eq(projectEstimateAssemblies.estimateId, estimateId)))
    if (!assembly) throw new Error("Assembly not found in this estimate.")
    const lineCount = (await access.db
      .select({ id: projectEstimateLines.id })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.assemblyId, assemblyId)))).length
    if (lineCount === 0) throw new Error("Add items to the assembly before exporting it.")

    const proposalId = crypto.randomUUID()
    const id = crypto.randomUUID()
    const newAssemblyId = crypto.randomUUID()
    const now = new Date().toISOString()
    const estimateNumber = await nextPhaseEstimateNumber(access.db, projectId, access.projectNumber)
    const results = await copyAssemblyAsPhaseEstimate(access.db, access.rawDb, {
      proposal: {
        id: proposalId,
        projectId,
        phaseName,
        assemblyName: assembly.name,
        sourceEstimateId: source.id,
        sourceEstimateNumber: source.estimateNumber,
        sourceVersionNumber: source.versionNumber,
        status: "proposed",
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      },
      header: {
        ...source,
        id,
        phaseProposalId: proposalId,
        estimateNumber,
        versionNumber: 1,
        title: phaseName,
        status: "draft",
        estimateDate: now.slice(0, 10),
        sourceSystem: "compass_revision",
        sourceRevision: `${assembly.name} from ${source.estimateNumber} version ${source.versionNumber}, exported as a phase on ${now.slice(0, 10)}`,
        foxitStatus: "not_started",
        foxitEnvelopeId: null,
        foxitEmbeddedSessionUrl: null,
        foxitPreparedSourceHash: null,
        foxitPreparedAt: null,
        signaturePackageUrl: null,
        signatureRequestedAt: null,
        signedAt: null,
        acceptanceMethod: null,
        acceptanceNote: null,
        acceptanceEvidenceLabel: null,
        acceptanceRecordedByName: null,
        acceptedAt: null,
        acceptedBy: null,
        sageStatus: "not_ready",
        sageRecordId: null,
        lastSageSyncAt: null,
        sourceHash: null,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      },
      estimateId: id,
      projectId,
      sourceEstimateId: estimateId,
      sourceAssemblyId: assemblyId,
      newAssemblyId,
      assembly,
      now,
    })
    if (results.some((result) => !result.success)) throw new Error("The phase estimate copy did not complete.")

    // The copied header carried the contract totals; price just this assembly.
    const lines = await access.db.select().from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, id))
    await updateEstimates(access.db, eq(projectEstimates.id, id), {
      ...estimateTotalsForLines(source, lines),
      updatedAt: now,
    })

    if (access.organizationId) {
      await recordActivityEvent({
        db: access.db,
        organizationId: access.organizationId,
        projectId,
        actor: access.user,
        category: "financial",
        action: "estimate_phase_proposal_created",
        entityType: "project_estimate",
        entityId: id,
        summary: `Exported ${assembly.name} from ${source.estimateNumber} as phase estimate ${estimateNumber} (${phaseName}).`,
        metadata: { phaseProposalId: proposalId, sourceEstimateId: source.id, lineCount },
      })
    }
    revalidatePhasePaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to export the phase." }
  }
}

/** Phase proposals on a job, newest first, with their latest estimate. */
export async function getProjectPhaseProposals(projectId: string): Promise<readonly ProjectPhaseProposalSummary[]> {
  const access = await estimateAccess(projectId, false)
  const proposals = await access.db
    .select()
    .from(projectPhaseProposals)
    .where(eq(projectPhaseProposals.projectId, projectId))
    .orderBy(desc(projectPhaseProposals.createdAt))
  if (proposals.length === 0) return []
  const proposalIds = proposals.map((proposal) => proposal.id)
  const phaseIds = proposals.flatMap((proposal) => proposal.familyPhaseId ? [proposal.familyPhaseId] : [])
  const deductIds = proposals.flatMap((proposal) => proposal.deductChangeOrderId ? [proposal.deductChangeOrderId] : [])
  const [estimates, phases, deducts] = await Promise.all([
    access.db
      .select({
        id: projectEstimates.id,
        phaseProposalId: projectEstimates.phaseProposalId,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        status: projectEstimates.status,
        totalCents: projectEstimates.estimateTotalCents,
      })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), inArray(projectEstimates.phaseProposalId, proposalIds)))
      .orderBy(desc(projectEstimates.versionNumber)),
    phaseIds.length > 0
      ? access.db
          .select({ id: projectFamilyPhases.id, projectNumber: projectFamilyPhases.projectNumber, projectId: projectFamilyPhases.projectId })
          .from(projectFamilyPhases)
          .where(inArray(projectFamilyPhases.id, phaseIds))
      : Promise.resolve([]),
    deductIds.length > 0
      ? access.db
          .select({ id: projectChangeOrders.id, number: projectChangeOrders.changeOrderNumber })
          .from(projectChangeOrders)
          .where(and(eq(projectChangeOrders.projectId, projectId), inArray(projectChangeOrders.id, deductIds)))
      : Promise.resolve([]),
  ])
  return proposals.map((proposal) => {
    const versions = estimates.filter((estimate) => estimate.phaseProposalId === proposal.id)
    const current = versions.find((estimate) => estimate.status === "accepted")
      ?? versions.find((estimate) => estimate.status !== "superseded" && estimate.status !== "void")
      ?? versions[0]
    return {
      id: proposal.id,
      phaseName: proposal.phaseName,
      assemblyName: proposal.assemblyName,
      sourceEstimateNumber: proposal.sourceEstimateNumber,
      sourceVersionNumber: proposal.sourceVersionNumber,
      status: proposal.status === "accepted" ? "accepted" : "proposed",
      estimate: current
        ? { id: current.id, estimateNumber: current.estimateNumber, versionNumber: current.versionNumber, status: current.status, totalCents: current.totalCents }
        : null,
      familyPhase: phases.find((phase) => phase.id === proposal.familyPhaseId) ?? null,
      contractRemoval: isPhaseProposalContractRemoval(proposal.contractRemoval) ? proposal.contractRemoval : null,
      deductChangeOrder: deducts.find((deduct) => deduct.id === proposal.deductChangeOrderId) ?? null,
      canDelete: proposal.status !== "accepted" && versions.every((estimate) => estimate.status !== "signature_pending" && estimate.status !== "accepted"),
    }
  })
}

/**
 * Deletes a phase proposal that was not accepted, with its estimate drafts.
 * The contract estimate was never changed, so nothing else is undone.
 */
export async function deletePhaseProposal(projectId: string, proposalId: string): Promise<PhaseProposalActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    requirePermission(access.user, "budget", "delete")
    const proposal = await access.db
      .select()
      .from(projectPhaseProposals)
      .where(and(eq(projectPhaseProposals.id, proposalId), eq(projectPhaseProposals.projectId, projectId)))
      .get()
    if (!proposal) throw new Error("Phase proposal not found.")
    if (proposal.status === "accepted") throw new Error("An accepted phase estimate can't be deleted.")
    const versions = await access.db
      .select({ id: projectEstimates.id, status: projectEstimates.status })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.phaseProposalId, proposalId)))
    if (versions.some((estimate) => estimate.status === "signature_pending" || estimate.status === "accepted")) {
      throw new Error("This phase estimate is out for signature. Cancel the signature request before deleting it.")
    }
    const versionIds = versions.map((estimate) => estimate.id)
    if (versionIds.length > 0) {
      const packet = await access.db
        .select({ id: contractPackets.id })
        .from(contractPackets)
        .where(and(eq(contractPackets.projectId, projectId), inArray(contractPackets.estimateId, versionIds)))
        .get()
      if (packet) throw new Error("Delete the contract packet for this phase estimate first.")
    }
    // Imported RFQ bids go with the drafts, as when a draft is deleted, so
    // the bid can be imported again; lines and details cascade.
    const estimateDeletes = versionIds.length > 0
      ? [
          ...rfqBidImportsForEstimatesDeleteQueries(access.db, projectId, versionIds),
          deleteEstimatesStatement(access.db, and(eq(projectEstimates.projectId, projectId), inArray(projectEstimates.id, versionIds))),
        ]
      : []
    await access.db.batch([
      deletePhaseProposalsStatement(access.db, eq(projectPhaseProposals.id, proposalId)),
      ...estimateDeletes,
    ])
    if (access.organizationId) {
      await recordActivityEvent({
        db: access.db,
        organizationId: access.organizationId,
        projectId,
        actor: access.user,
        category: "financial",
        action: "estimate_phase_proposal_deleted",
        entityType: "project_phase_proposal",
        entityId: proposalId,
        summary: `Deleted the ${proposal.phaseName} phase estimate (${proposal.assemblyName}). The contract estimate was not changed.`,
        metadata: { estimateCount: versionIds.length },
      })
    }
    revalidatePhasePaths(projectId)
    return { success: true, id: proposalId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete the phase estimate." }
  }
}

/** Runs the phase setup again for an accepted phase estimate whose setup didn't finish. */
export async function finishPhaseProposal(projectId: string, proposalId: string): Promise<PhaseProposalActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await access.db
      .select()
      .from(projectEstimates)
      .where(and(
        eq(projectEstimates.projectId, projectId),
        eq(projectEstimates.phaseProposalId, proposalId),
        eq(projectEstimates.status, "accepted"),
      ))
      .get()
    if (!estimate) throw new Error("Accept the phase estimate first.")
    const result = await completePhaseProposal({
      db: access.db,
      estimate,
      actor: { id: access.user.id, name: activityActorName(access.user), role: access.user.role },
      now: new Date().toISOString(),
    })
    if (!result.success) return result
    revalidatePhasePaths(projectId)
    return { success: true, id: proposalId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to finish the phase setup." }
  }
}
