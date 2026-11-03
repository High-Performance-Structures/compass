import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { projectChangeOrders, projectContacts } from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import {
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"
import { projectFamilyPhases } from "@/db/schema-project-families"
import { recordActivityEvent } from "@/lib/activity-log"
import { estimateAccess, type CompassDb, type EstimateAccess } from "@/lib/domain/estimates/access"
import { isEstimateStatus, signerInitials } from "@/lib/domain/estimates/rules"
import {
  estimateCopyStatements,
  insertEstimate,
  insertEstimateAssemblyStatement,
  insertEstimateReportPhaseStatement,
  insertEstimateStatement,
  updateChangeOrdersStatement,
  type Statement,
} from "@/lib/domain/estimates/store"
import { defaultEstimateTitle } from "@/lib/estimates/client-report"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import { nextEstimateNumber } from "@/lib/estimates/estimate-modes"
import { numberNewEstimate, readEstimateMode } from "@/lib/estimates/numbering"

/** Creating, copying and deleting estimate drafts. Callers check access first. */

type ContactRow = typeof projectContacts.$inferSelect

/** A project's active contacts, primary first: the default signers. */
async function signerContacts(db: CompassDb, projectId: string): Promise<ContactRow[]> {
  return db
    .select()
    .from(projectContacts)
    .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
    .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder))
}

function ownerSigners(contacts: readonly ContactRow[]): {
  readonly contactId: string
  readonly name: string
  readonly title: string
  readonly email: string
  readonly initials: string
}[] {
  return contacts
    .filter((contact) => contact.contactType === "owner")
    .map((contact) => ({
      contactId: contact.id,
      name: contact.displayName,
      title: contact.role ?? "",
      email: contact.email ?? "",
      initials: signerInitials(contact.displayName),
    }))
}

/** A new draft numbered for the department, with the project's signers. Returns its id. */
export async function createEstimateDraft(access: EstimateAccess, projectId: string): Promise<string> {
  const mode = await readEstimateMode(access.db, access.organizationId, access.department)
  const { estimateNumber, versionNumber } = await numberNewEstimate(access.db, {
    projectId,
    projectNumber: access.projectNumber,
    mode,
  })
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const contactRows = await signerContacts(access.db, projectId)
  const clientSigners = ownerSigners(contactRows)
  const clientSigner = clientSigners[0]
  const companySigner = contactRows.find((contact) => contact.contactType === "internal")
  await insertEstimate(access.db, {
    id,
    projectId,
    estimateNumber,
    versionNumber,
    title: defaultEstimateTitle(access.department),
    status: "draft",
    estimateDate: now.slice(0, 10),
    clientName: access.projectClientName,
    clientMailingAddress: access.projectMailingAddress,
    clientSignerContactId: clientSigner?.contactId ?? null,
    clientSignerName: clientSigner?.name ?? null,
    clientSignerTitle: clientSigner?.title ?? null,
    clientSignerEmail: clientSigner?.email ?? null,
    clientSignersJson: JSON.stringify(clientSigners),
    companySignerContactId: companySigner?.id ?? null,
    companySignerName: companySigner?.displayName ?? null,
    companySignerTitle: companySigner?.role ?? null,
    companySignerEmail: companySigner?.email ?? null,
    companySignerInitials: companySigner ? signerInitials(companySigner.displayName) : null,
    sourceSystem: "compass",
    createdBy: access.user.id,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

/**
 * A change-order estimate's starting assemblies: one per chosen contract
 * assembly, empty and linked to it, with the report phases its lines use, so
 * added and credited lines land in that assembly on the budget.
 */
async function changeOrderAssemblyStatements(
  db: CompassDb,
  input: {
    readonly projectId: string
    readonly estimateId: string
    readonly contractEstimateId: string | null
    readonly contractAssemblyIds: readonly string[]
    readonly now: string
  }
): Promise<Statement[]> {
  const ids = [...new Set(input.contractAssemblyIds)]
  if (ids.length === 0) return []
  if (!input.contractEstimateId) throw new Error("Accept the contract estimate before changing its assemblies.")
  const [assemblies, phaseIds] = await Promise.all([
    db
      .select()
      .from(projectEstimateAssemblies)
      .where(and(eq(projectEstimateAssemblies.estimateId, input.contractEstimateId), inArray(projectEstimateAssemblies.id, ids))),
    db
      .selectDistinct({ id: projectEstimateLines.reportPhaseId })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.estimateId, input.contractEstimateId), inArray(projectEstimateLines.assemblyId, ids))),
  ])
  if (assemblies.length !== ids.length) throw new Error("Choose assemblies from the accepted contract estimate.")
  const usedPhaseIds = phaseIds.flatMap((row) => (row.id ? [row.id] : []))
  const phases =
    usedPhaseIds.length > 0
      ? await db
          .select()
          .from(projectEstimateReportPhases)
          .where(and(eq(projectEstimateReportPhases.estimateId, input.contractEstimateId), inArray(projectEstimateReportPhases.id, usedPhaseIds)))
      : []
  return [
    ...assemblies.map((assembly) =>
      insertEstimateAssemblyStatement(db, {
        id: crypto.randomUUID(),
        estimateId: input.estimateId,
        name: assembly.name,
        description: assembly.description,
        sortOrder: assembly.sortOrder,
        clientDetail: assembly.clientDetail,
        contractAssemblyId: assembly.id,
        createdAt: input.now,
        updatedAt: input.now,
      })
    ),
    ...phases.map((phase) =>
      insertEstimateReportPhaseStatement(db, {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        estimateId: input.estimateId,
        divisionCode: phase.divisionCode,
        name: phase.name,
        description: phase.description,
        itemize: phase.itemize,
        sortOrder: phase.sortOrder,
        createdAt: input.now,
        updatedAt: input.now,
      })
    ),
  ]
}

/**
 * Starts the estimate for a change order: built, previewed, printed and
 * signed like the contract estimate, numbered after the change order.
 * Accepting it executes the change order and adds it to the budget. Header
 * details (client, signers, terms, report style, builder-fee rates) come from
 * the accepted contract estimate when there is one. An existing one is
 * returned as is (`created: false`).
 */
export async function createChangeOrderEstimate(
  access: EstimateAccess,
  projectId: string,
  changeOrderId: string,
  contractAssemblyIds: readonly string[]
): Promise<{ readonly id: string; readonly created: boolean }> {
  const changeOrder = await access.db
    .select({
      id: projectChangeOrders.id,
      number: projectChangeOrders.changeOrderNumber,
      title: projectChangeOrders.title,
      status: projectChangeOrders.status,
      budgetTreatment: projectChangeOrders.budgetTreatment,
      kind: projectChangeOrders.changeOrderKind,
    })
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)))
    .get()
  if (!changeOrder) throw new Error("Change order not found.")
  if (changeOrder.kind === "description" || changeOrder.kind === "contract_version") {
    throw new Error("This change order isn't priced with an estimate; change how it's built first.")
  }
  if (["executed", "sage_pending", "synced", "closed", "declined", "void"].includes(changeOrder.status)) {
    throw new Error(`Change order ${changeOrder.number} is already ${changeOrder.status.replace("_", " ")}.`)
  }
  if (changeOrder.budgetTreatment === "baseline_replacement") {
    throw new Error("This change order replaces the contract estimate; revise the contract estimate instead.")
  }
  const existing = await access.db
    .select({ id: projectEstimates.id })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.changeOrderId, changeOrderId)))
    .limit(1)
    .get()
  if (existing) return { id: existing.id, created: false }

  const contract = await access.db
    .select()
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.status, "accepted"), ...contractEstimateConditions()))
    .orderBy(desc(projectEstimates.versionNumber))
    .limit(1)
    .get()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const assemblyStatements = await changeOrderAssemblyStatements(access.db, {
    projectId,
    estimateId: id,
    contractEstimateId: contract?.id ?? null,
    contractAssemblyIds,
    now,
  })
  const contactRows = contract ? [] : await signerContacts(access.db, projectId)
  const clientSigners = ownerSigners(contactRows)
  const clientSigner = clientSigners[0]
  const companySigner = contactRows.find((contact) => contact.contactType === "internal")
  const estimateInsert = insertEstimateStatement(access.db, {
    id,
    projectId,
    changeOrderId,
    estimateNumber: changeOrder.number,
    versionNumber: 1,
    title: `Change Order ${changeOrder.number}: ${changeOrder.title}`.slice(0, 200),
    status: "draft",
    estimateDate: now.slice(0, 10),
    clientName: contract?.clientName ?? access.projectClientName,
    clientMailingAddress: contract?.clientMailingAddress ?? access.projectMailingAddress,
    clientSignerContactId: contract ? contract.clientSignerContactId : clientSigner?.contactId ?? null,
    clientSignerName: contract ? contract.clientSignerName : clientSigner?.name ?? null,
    clientSignerTitle: contract ? contract.clientSignerTitle : clientSigner?.title ?? null,
    clientSignerEmail: contract ? contract.clientSignerEmail : clientSigner?.email ?? null,
    clientSignersJson: contract ? contract.clientSignersJson : JSON.stringify(clientSigners),
    companySignerContactId: contract ? contract.companySignerContactId : companySigner?.id ?? null,
    companySignerName: contract ? contract.companySignerName : companySigner?.displayName ?? null,
    companySignerTitle: contract ? contract.companySignerTitle : companySigner?.role ?? null,
    companySignerEmail: contract ? contract.companySignerEmail : companySigner?.email ?? null,
    companySignerInitials: contract
      ? contract.companySignerInitials
      : companySigner
        ? signerInitials(companySigner.displayName)
        : null,
    termsTemplateId: contract?.termsTemplateId ?? null,
    contractTerms: contract?.contractTerms ?? null,
    clientReportMode: contract?.clientReportMode ?? null,
    showCostBreakdowns: contract?.showCostBreakdowns ?? false,
    overheadRateBasisPoints: contract?.overheadRateBasisPoints ?? 0,
    marginRateBasisPoints: contract?.marginRateBasisPoints ?? 0,
    contingencyRateBasisPoints: contract?.contingencyRateBasisPoints ?? 0,
    sourceSystem: "compass",
    createdBy: access.user.id,
    createdAt: now,
    updatedAt: now,
  })
  // An older recorded change order becomes one priced by this estimate.
  await access.db.batch([
    estimateInsert,
    ...assemblyStatements,
    updateChangeOrdersStatement(
      access.db,
      and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)),
      { changeOrderKind: "estimate", updatedAt: now }
    ),
  ])
  return { id, created: true }
}

type DeletableDraft = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
}

/** The draft, when it can be deleted: still a draft, with no contract packet. */
export async function deletableEstimateDraft(
  access: EstimateAccess,
  projectId: string,
  estimateId: string
): Promise<DeletableDraft> {
  const [estimateRows, linkedPacketRows] = await Promise.all([
    access.db
      .select({
        id: projectEstimates.id,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        status: projectEstimates.status,
      })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId)))
      .limit(1),
    access.db
      .select({ id: contractPackets.id })
      .from(contractPackets)
      .where(and(eq(contractPackets.projectId, projectId), eq(contractPackets.estimateId, estimateId)))
      .limit(1),
  ])
  const estimate = estimateRows[0]
  if (!estimate) throw new Error("Estimate draft not found.")
  if (estimate.status !== "draft") {
    throw new Error("Only draft estimates can be deleted.")
  }
  if (linkedPacketRows[0]) {
    throw new Error("Delete the contract packet linked to this draft before deleting the estimate.")
  }
  return estimate
}

export async function recordEstimateDraftDeleted(
  access: EstimateAccess,
  projectId: string,
  estimate: DeletableDraft
): Promise<void> {
  if (!access.organizationId) return
  await recordActivityEvent({
    db: access.db,
    organizationId: access.organizationId,
    projectId,
    actor: access.user,
    category: "financial",
    action: "estimate_draft_deleted",
    entityType: "project_estimate",
    entityId: estimate.id,
    summary: `Deleted draft ${estimate.estimateNumber} version ${estimate.versionNumber}.`,
    metadata: {
      estimateNumber: estimate.estimateNumber,
      versionNumber: estimate.versionNumber,
    },
  })
}

export type EstimateCopyDestination = {
  readonly destinationPhaseId: string | null
  readonly versionNumber: number | null
  /**
   * "separate": a new estimate with the next number (departments with
   * several estimates per job); the original stays usable. Default: the
   * next version of the same estimate.
   */
  readonly kind?: "version" | "separate"
  /** Name for a separate estimate. */
  readonly title?: string | null
}

/**
 * Copies an estimate into a new draft: the next version, a separate estimate,
 * or a version on another activated phase of the project family (which needs
 * edit access there too). Returns the new id and the project it is on.
 */
export async function duplicateEstimate(
  access: EstimateAccess,
  projectId: string,
  sourceEstimateId: string,
  destination: EstimateCopyDestination | undefined
): Promise<{ readonly id: string; readonly destinationProjectId: string }> {
  const sourceRows = await access.db
    .select()
    .from(projectEstimates)
    .where(and(eq(projectEstimates.id, sourceEstimateId), eq(projectEstimates.projectId, projectId)))
    .limit(1)
  const source = sourceRows[0]
  if (!source || !isEstimateStatus(source.status)) {
    throw new Error("Estimate version not found.")
  }

  let destinationProjectId = projectId
  if (destination?.destinationPhaseId) {
    const [sourcePhase] = await access.db
      .select({ familyId: projectFamilyPhases.familyId })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.projectId, projectId))
      .limit(1)
    const [destinationPhase] = await access.db
      .select({
        familyId: projectFamilyPhases.familyId,
        projectId: projectFamilyPhases.projectId,
      })
      .from(projectFamilyPhases)
      .where(eq(projectFamilyPhases.id, destination.destinationPhaseId))
      .limit(1)
    if (!sourcePhase || destinationPhase?.familyId !== sourcePhase.familyId) {
      throw new Error("Choose a phase in this project family.")
    }
    if (!destinationPhase.projectId) {
      throw new Error("Activate the destination phase before copying an estimate.")
    }
    destinationProjectId = destinationPhase.projectId
  }
  const changingPhase = destinationProjectId !== projectId
  const destinationAccess = changingPhase ? await estimateAccess(destinationProjectId, true) : access
  const separate = destination?.kind === "separate"
  if (source.changeOrderId && (separate || changingPhase)) {
    throw new Error("A change-order estimate can only get a new version on its own change order.")
  }
  if (source.phaseProposalId && (separate || changingPhase)) {
    throw new Error("A phase estimate can only get a new version of itself.")
  }
  if (separate && changingPhase) {
    throw new Error("A separate estimate is made on this job; copy to another phase as a new version.")
  }
  if (separate && (await readEstimateMode(access.db, access.organizationId, access.department)) !== "multiple") {
    throw new Error("This department has one estimate per job. Duplicate it as a new version instead.")
  }
  const estimateNumber = separate
    ? nextEstimateNumber(
        access.projectNumber,
        (
          await access.db
            .select({ estimateNumber: projectEstimates.estimateNumber })
            .from(projectEstimates)
            .where(eq(projectEstimates.projectId, projectId))
        ).map((row) => row.estimateNumber),
      )
    : changingPhase
      ? `${destinationAccess.projectNumber ?? "PROJECT"}-00`
      : source.estimateNumber
  const priorVersions = await access.db
    .select({ versionNumber: projectEstimates.versionNumber })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, destinationProjectId), eq(projectEstimates.estimateNumber, estimateNumber)))
    .orderBy(desc(projectEstimates.versionNumber))
    .limit(1)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const latestVersion = priorVersions[0]?.versionNumber ?? 0
  if (latestVersion >= 9999) {
    throw new Error("This project phase has reached the maximum estimate version number.")
  }
  const versionNumber = destination?.versionNumber ?? latestVersion + 1
  if (!Number.isSafeInteger(versionNumber) || versionNumber <= latestVersion || versionNumber > 9999) {
    throw new Error(`Choose a version number between ${latestVersion + 1} and 9999.`)
  }
  const destinationContacts = changingPhase ? await signerContacts(access.db, destinationProjectId) : []
  const clientSigners = ownerSigners(destinationContacts)
  const clientSigner = clientSigners[0]
  const companySigner = destinationContacts.find((contact) => contact.contactType === "internal")
  const companySignerInitials = companySigner ? signerInitials(companySigner.displayName) : null
  const sourcePhases = await access.db.select().from(projectEstimateReportPhases)
    .where(and(eq(projectEstimateReportPhases.estimateId, sourceEstimateId), eq(projectEstimateReportPhases.projectId, projectId)))
  const sourceAssemblies = await access.db.select().from(projectEstimateAssemblies)
    .where(eq(projectEstimateAssemblies.estimateId, sourceEstimateId))
  const separateTitle = separate ? destination?.title?.trim().slice(0, 200) : undefined
  const copyStatements = estimateCopyStatements({
    db: access.db,
    rawDb: access.rawDb,
    sourceProjectId: projectId,
    sourceEstimateId,
    destinationProjectId,
    estimateNumber,
    now,
    phases: sourcePhases,
    assemblies: sourceAssemblies,
    header: {
      ...source,
      id,
      projectId: destinationProjectId,
      estimateNumber,
      versionNumber,
      ...(separateTitle ? { title: separateTitle } : {}),
      status: "draft",
      estimateDate: now.slice(0, 10),
      clientName: changingPhase ? destinationAccess.projectClientName : source.clientName,
      clientMailingAddress: changingPhase ? destinationAccess.projectMailingAddress : source.clientMailingAddress,
      clientSignerContactId: changingPhase ? clientSigner?.contactId ?? null : source.clientSignerContactId,
      clientSignerName: changingPhase ? clientSigner?.name ?? null : source.clientSignerName,
      clientSignerTitle: changingPhase ? clientSigner?.title ?? null : source.clientSignerTitle,
      clientSignerEmail: changingPhase ? clientSigner?.email ?? null : source.clientSignerEmail,
      clientSignersJson: changingPhase ? JSON.stringify(clientSigners) : source.clientSignersJson,
      companySignerContactId: changingPhase ? companySigner?.id ?? null : source.companySignerContactId,
      companySignerName: changingPhase ? companySigner?.displayName ?? null : source.companySignerName,
      companySignerTitle: changingPhase ? companySigner?.role ?? null : source.companySignerTitle,
      companySignerEmail: changingPhase ? companySigner?.email ?? null : source.companySignerEmail,
      companySignerInitials: changingPhase ? companySignerInitials : source.companySignerInitials,
      sourceSystem: "compass_revision",
      sourceWorkbookId: changingPhase ? null : source.sourceWorkbookId,
      sourceWorkbookUrl: changingPhase ? null : source.sourceWorkbookUrl,
      sourceRevision:
        `Duplicated from ${source.estimateNumber} version ${source.versionNumber}` +
        ` on ${now.slice(0, 10)}`,
      templateVersionId: changingPhase ? null : source.templateVersionId,
      templateApplicationId: changingPhase ? null : source.templateApplicationId,
      termsTemplateId: changingPhase ? null : source.termsTemplateId,
      introductionTemplateId: changingPhase ? null : source.introductionTemplateId,
      closingTemplateId: changingPhase ? null : source.closingTemplateId,
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
  })
  const copyResults = await access.rawDb.batch(copyStatements)
  if (copyResults.some((result) => !result.success)) {
    throw new Error("The estimate version copy did not complete.")
  }
  return { id, destinationProjectId }
}
