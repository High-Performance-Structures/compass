import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projects,
} from "@/db/schema"
import {
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimates,
  projectPhaseProposals,
} from "@/db/schema-estimates"
import { projectFamilies, projectFamilyPhases } from "@/db/schema-project-families"
import { changeOrderLinesFromEstimate } from "@/lib/change-orders/estimate-execution"
import { changeOrderNumber } from "@/lib/change-orders/numbering"
import type { CompassDb } from "@/lib/estimates/access"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import { estimateLinesBudgetLedgerLines } from "@/lib/financials/contract-budget-store"
import { calculateEstimateTotals, type EstimateLedgerLine } from "@/lib/financials/estimate-ledger"
import { projectFamilyProjectNumber } from "@/lib/project-family"

/*
 * A phase proposal offers one assembly of the contract estimate as a later
 * project family phase. Nothing changes until its estimate is accepted; then
 * the assembly leaves the contract estimate and the phase is created,
 * authorized at the accepted amount and ready to activate.
 */

export const PHASE_PROPOSAL_CONTRACT_REMOVALS = [
  /** Removed from the draft contract estimate. */
  "removed_from_estimate",
  /** The contract estimate was signed; a draft deduct change order was made. */
  "deduct_change_order",
  /** The contract estimate is out for signature; staff decide. */
  "contract_out_for_signature",
  /** The contract estimate no longer has an assembly by that name. */
  "not_in_contract",
] as const

export type PhaseProposalContractRemoval = (typeof PHASE_PROPOSAL_CONTRACT_REMOVALS)[number]

export function isPhaseProposalContractRemoval(value: string | null): value is PhaseProposalContractRemoval {
  return PHASE_PROPOSAL_CONTRACT_REMOVALS.some((removal) => removal === value)
}

type EstimateRow = typeof projectEstimates.$inferSelect
type LineRow = typeof projectEstimateLines.$inferSelect

function sameAssemblyName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function ledgerLine(row: LineRow): EstimateLedgerLine {
  return {
    id: row.id,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    costCode: row.costCode,
    description: row.description,
    directCostCents: row.directCostCents,
    markupCents: row.markupCents,
    taxCents: row.taxCents,
    lineTotalCents: row.lineTotalCents,
    ownerVisible: row.ownerVisible,
    includeInBuilderFee: row.includeInBuilderFee,
    sortOrder: row.sortOrder,
  }
}

/** An estimate's saved totals for its lines at its builder-fee rates. */
export function estimateTotalsForLines(
  estimate: Pick<EstimateRow, "overheadRateBasisPoints" | "marginRateBasisPoints" | "contingencyRateBasisPoints">,
  rows: readonly LineRow[]
): ReturnType<typeof calculateEstimateTotals> {
  return calculateEstimateTotals(rows.map(ledgerLine), estimate)
}

/** The contract estimate the assembly leaves: a signed one first, else the newest in progress. */
async function currentContractEstimate(db: CompassDb, projectId: string): Promise<EstimateRow | null> {
  const rows = await db
    .select()
    .from(projectEstimates)
    .where(and(
      eq(projectEstimates.projectId, projectId),
      ...contractEstimateConditions(),
      inArray(projectEstimates.status, ["draft", "internal_review", "signature_pending", "accepted"]),
    ))
    .orderBy(desc(projectEstimates.versionNumber))
  return rows.find((row) => row.status === "accepted") ?? rows[0] ?? null
}

/**
 * Finishes a phase proposal after its estimate is accepted. Safe to run
 * again: a proposal that is already accepted is left as it is.
 */
export async function completePhaseProposal(input: {
  readonly db: CompassDb
  readonly estimate: EstimateRow
  readonly actor: { readonly id: string | null; readonly name: string; readonly role: string }
  readonly now: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const { db, estimate, now } = input
    const proposalId = estimate.phaseProposalId
    if (!proposalId) return { success: false, error: "This estimate isn't a phase estimate." }
    const proposal = await db
      .select()
      .from(projectPhaseProposals)
      .where(and(eq(projectPhaseProposals.id, proposalId), eq(projectPhaseProposals.projectId, estimate.projectId)))
      .get()
    if (!proposal) return { success: false, error: "The phase proposal no longer exists." }
    if (proposal.status === "accepted") return { success: true }

    const project = await db
      .select({
        id: projects.id,
        name: projects.name,
        organizationId: projects.organizationId,
        clientName: projects.clientName,
        address: projects.address,
        jobStatusId: projects.jobStatusId,
        projectNumber: projects.projectNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.id, estimate.projectId))
      .get()
    if (!project?.organizationId) return { success: false, error: "The project needs a company before it can have phases." }
    const organizationId = project.organizationId

    // The job's family, created now if this is its first extra phase.
    const projectPhase = await db
      .select({ familyId: projectFamilyPhases.familyId })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, project.id))
      .get()
    const familyId = projectPhase?.familyId ?? `family-${crypto.randomUUID()}`
    const familyStatements: BatchItem<"sqlite">[] = projectPhase
      ? []
      : [
          db.insert(projectFamilies).values({
            id: familyId,
            organizationId,
            name: project.name,
            description: null,
            clientName: project.clientName,
            address: project.address,
            status: "OPEN",
            googleDriveFolderId: project.googleDriveFolderId,
            createdBy: input.actor.id,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(projectFamilyPhases).values({
            id: crypto.randomUUID(),
            familyId,
            projectId: project.id,
            projectNumber: project.projectNumber,
            googleDriveFolderId: project.googleDriveFolderId,
            sequence: 1,
            name: project.name,
            description: null,
            jobStatusId: project.jobStatusId,
            originatingChangeOrderId: null,
            authorizedContractAmountCents: null,
            authorizedAt: null,
            createdBy: input.actor.id,
            createdAt: now,
            updatedAt: now,
          }),
        ]
    const [familyPhases, takenProjects] = await Promise.all([
      projectPhase
        ? db
            .select({ sequence: projectFamilyPhases.sequence, projectNumber: projectFamilyPhases.projectNumber })
            .from(projectFamilyPhases)
            .where(eq(projectFamilyPhases.familyId, familyId))
        : Promise.resolve([{ sequence: 1, projectNumber: project.projectNumber }]),
      db.select({ projectNumber: projects.projectNumber }).from(projects).where(eq(projects.organizationId, organizationId)),
    ])
    const baseNumber = familyPhases.find((phase) => phase.sequence === 1)?.projectNumber ?? project.projectNumber
    if (!baseNumber) return { success: false, error: "The project needs a project number before it can have phases." }
    const taken = new Set([
      ...takenProjects.map((row) => row.projectNumber),
      ...familyPhases.map((phase) => phase.projectNumber),
    ])
    let sequence = Math.max(1, ...familyPhases.map((phase) => phase.sequence)) + 1
    let phaseNumber = projectFamilyProjectNumber(baseNumber, sequence)
    while (phaseNumber && taken.has(phaseNumber) && sequence < 100) {
      sequence += 1
      phaseNumber = projectFamilyProjectNumber(baseNumber, sequence)
    }
    if (!phaseNumber || taken.has(phaseNumber)) {
      return { success: false, error: "Compass could not build the phased project number." }
    }
    const familyPhaseId = crypto.randomUUID()

    // Take the assembly out of the contract estimate, or draft a deduct
    // change order when that estimate is already signed.
    const contract = await currentContractEstimate(db, project.id)
    const assembly = contract
      ? (await db
          .select()
          .from(projectEstimateAssemblies)
          .where(eq(projectEstimateAssemblies.estimateId, contract.id)))
          .find((row) => sameAssemblyName(row.name, proposal.assemblyName)) ?? null
      : null
    const contractLines = contract
      ? await db.select().from(projectEstimateLines).where(eq(projectEstimateLines.estimateId, contract.id))
      : []
    const assemblyLines = assembly ? contractLines.filter((line) => line.assemblyId === assembly.id) : []
    let contractRemoval: PhaseProposalContractRemoval = "not_in_contract"
    let deductChangeOrderId: string | null = null
    const removalStatements: BatchItem<"sqlite">[] = []
    if (contract && assembly && assemblyLines.length > 0) {
      if (contract.status === "draft" || contract.status === "internal_review") {
        contractRemoval = "removed_from_estimate"
        const remaining = contractLines.filter((line) => line.assemblyId !== assembly.id)
        const removedIds = assemblyLines.map((line) => line.id)
        // D1 limits bind parameters per statement; chunk the deletes in the batch.
        for (let offset = 0; offset < removedIds.length; offset += 80) {
          removalStatements.push(db.delete(projectEstimateLines).where(and(
            eq(projectEstimateLines.estimateId, contract.id),
            inArray(projectEstimateLines.id, removedIds.slice(offset, offset + 80)),
          )))
        }
        removalStatements.push(
          db.delete(projectEstimateAssemblies).where(eq(projectEstimateAssemblies.id, assembly.id)),
          db.update(projectEstimates)
            .set({ ...estimateTotalsForLines(contract, remaining), updatedAt: now })
            .where(eq(projectEstimates.id, contract.id)),
        )
      } else if (contract.status === "accepted") {
        contractRemoval = "deduct_change_order"
        const ledger = await estimateLinesBudgetLedgerLines(db, contract, assemblyLines)
        const lines = changeOrderLinesFromEstimate(ledger).map((line) => ({ ...line, amountCents: -line.amountCents }))
        const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
        const existing = await db
          .select({ id: projectChangeOrders.id })
          .from(projectChangeOrders)
          .where(eq(projectChangeOrders.projectId, project.id))
        const changeOrderId = crypto.randomUUID()
        deductChangeOrderId = changeOrderId
        removalStatements.push(
          db.insert(projectChangeOrders).values({
            id: changeOrderId,
            projectId: project.id,
            changeOrderNumber: changeOrderNumber(project.projectNumber, existing.length),
            title: `Deduct ${proposal.assemblyName}: moved to ${proposal.phaseName}`.slice(0, 200),
            scope: `Remove the ${proposal.assemblyName} assembly from contract estimate ${contract.estimateNumber} version ${contract.versionNumber}. The client accepted it as its own phase, ${proposal.phaseName} (${phaseNumber}), in estimate ${estimate.estimateNumber}.`,
            reason: "Scope moved to a separate project phase.",
            amountCents,
            scheduleImpactDays: null,
            status: "draft",
            audience: "owner",
            requesterType: "internal",
            requesterUserId: input.actor.id,
            requesterName: input.actor.name.slice(0, 200),
            requesterCompany: null,
            sourceType: "internal_request",
            sourceRecordId: proposal.id,
            sourceHref: null,
            internalNotes: null,
            budgetTreatment: "additive",
            foxitStatus: "not_started",
            sageStatus: "not_ready",
            createdBy: input.actor.id,
            submittedAt: null,
            createdAt: now,
            updatedAt: now,
          }),
          db.insert(projectChangeOrderHistory).values({
            id: crypto.randomUUID(),
            projectId: project.id,
            changeOrderId,
            eventType: "created",
            fromStatus: null,
            toStatus: "draft",
            actorUserId: input.actor.id,
            actorName: input.actor.name.slice(0, 200),
            actorRole: input.actor.role.slice(0, 80),
            note: `Drafted when phase estimate ${estimate.estimateNumber} was accepted.`,
            metadataJson: JSON.stringify({ phaseProposalId: proposal.id, lineCount: lines.length }),
            createdAt: now,
          }),
        )
        // Each line binds 10 columns; ten per statement stays under D1's limit.
        for (let index = 0; index < lines.length; index += 10) {
          removalStatements.push(db.insert(projectChangeOrderLines).values(
            lines.slice(index, index + 10).map((line) => ({
              id: crypto.randomUUID(),
              projectId: project.id,
              changeOrderId,
              lineNumber: line.lineNumber,
              description: line.description.slice(0, 500),
              phaseCode: line.phaseCode,
              costCode: line.costCode,
              amountCents: line.amountCents,
              createdAt: now,
              updatedAt: now,
            }))
          ))
        }
      } else {
        contractRemoval = "contract_out_for_signature"
      }
    }

    const phaseInsert = db.insert(projectFamilyPhases).values({
        id: familyPhaseId,
        familyId,
        projectId: null,
        projectNumber: phaseNumber,
        googleDriveFolderId: null,
        sequence,
        name: proposal.phaseName,
        description: `${proposal.assemblyName}, from estimate ${proposal.sourceEstimateNumber}. Accepted in ${estimate.estimateNumber}.`,
        jobStatusId: "awaiting_funding",
        originatingChangeOrderId: null,
        authorizedContractAmountCents: estimate.estimateTotalCents,
        authorizedAt: estimate.signedAt ?? now,
        createdBy: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
    const proposalUpdate = db.update(projectPhaseProposals)
        .set({
          status: "accepted",
          familyPhaseId,
          contractRemoval,
          deductChangeOrderId,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(eq(projectPhaseProposals.id, proposal.id))
    // The family (when new) goes in before its phase; all of it in one batch.
    const [first, ...rest] = [...familyStatements, phaseInsert, ...removalStatements, proposalUpdate]
    if (first) await db.batch([first, ...rest])
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to finish the phase proposal.",
    }
  }
}

/** The next phase estimate number on a job: <project number>-P1 and up. */
export async function nextPhaseEstimateNumber(db: CompassDb, projectId: string, projectNumber: string | null): Promise<string> {
  const prefix = `${projectNumber?.trim() || "PROJECT"}-P`
  const rows = await db
    .select({ estimateNumber: projectEstimates.estimateNumber })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, projectId), isNotNull(projectEstimates.phaseProposalId)))
  const used = rows
    .map((row) => row.estimateNumber.startsWith(prefix) ? Number(row.estimateNumber.slice(prefix.length)) : 0)
    .filter((value) => Number.isSafeInteger(value))
  return `${prefix}${Math.max(0, ...used) + 1}`
}
