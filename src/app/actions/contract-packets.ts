"use server"

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { getDb } from "@/db"
import { projectContacts, projects } from "@/db/schema"
import {
  contractDocumentTemplates,
  contractDocumentTemplateVersions,
  contractPacketDocuments,
  contractPackets,
} from "@/db/schema-contracts"
import { projectEstimates } from "@/db/schema-estimates"
import { requireAuth, type AuthUser } from "@/lib/auth"
import {
  contractDepositCents,
  contractPacketCanBeEdited,
  parsePacketSigners,
  signerInitials,
  type ContractPacketSigner,
} from "@/lib/contracts/packet"
import {
  loadContractPacketPdfBranding,
  prepareContractPacketPdf,
} from "@/lib/contracts/packet-pdf"
import { getCloudflareContext } from "@/lib/db"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { createFoxitPreparedEnvelope } from "@/lib/foxit/esign"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  projectDepartment,
  projectLegalEntityName,
  type ProjectDepartment,
} from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

type CompassDb = ReturnType<typeof getDb>

type ContractPacketAccess = {
  readonly db: CompassDb
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectAddress: string | null
  readonly projectMailingAddress: string | null
  readonly projectClientName: string | null
  readonly organizationId: string
  readonly department: ProjectDepartment
  readonly canEdit: boolean
}

export type ProjectContractPacketDocumentItem = {
  readonly id: string
  readonly templateId: string | null
  readonly templateVersionId: string | null
  readonly code: string
  readonly title: string
  readonly contentMarkdown: string
  readonly inclusionMode: string
  readonly signingStage: string
  readonly signaturePolicy: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly sourceUrl: string | null
  readonly sortOrder: number
}

export type ProjectContractPacketSummary = {
  readonly id: string
  readonly estimateId: string
  readonly packetNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly legalEntityName: string
  readonly contractDraftDate: string | null
  readonly approximateCommencementDate: string | null
  readonly approximateCompletionDate: string | null
  readonly depositRateBasisPoints: number
  readonly depositCents: number
  readonly latePaymentRateBasisPoints: number
  readonly details: Readonly<Record<string, string>>
  readonly clientSigners: readonly ContractPacketSigner[]
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
  readonly companySignerInitials: string | null
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
  readonly foxitEmbeddedSessionUrl: string | null
  readonly signaturePackageUrl: string | null
  readonly signedAt: string | null
  readonly acceptanceMethod: string | null
  readonly acceptanceEvidenceLabel: string | null
  readonly acceptanceRecordedByName: string | null
  readonly acceptedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type ProjectContractTemplateOption = {
  readonly id: string
  readonly versionId: string
  readonly versionNumber: number
  readonly code: string
  readonly name: string
  readonly category: string
  readonly signingStage: string
  readonly inclusionMode: string
  readonly contentMarkdown: string
  readonly sourceUrl: string | null
  readonly sortOrder: number
}

export type ProjectContractPacketEstimateOption = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly clientMailingAddress: string | null
  readonly builderFeeCents: number
  readonly builderFeeRateBasisPoints: number
  readonly estimateTotalCents: number
}

export type ProjectContractSignerOption = {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly companyName: string | null
  readonly email: string | null
  readonly contactType: string
}

export type ProjectContractPacketWorkspace = {
  readonly canEdit: boolean
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectAddress: string | null
  readonly projectMailingAddress: string | null
  readonly department: ProjectDepartment
  readonly packets: readonly ProjectContractPacketSummary[]
  readonly activePacket: ProjectContractPacketSummary | null
  readonly documents: readonly ProjectContractPacketDocumentItem[]
  readonly templateOptions: readonly ProjectContractTemplateOption[]
  readonly estimateOptions: readonly ProjectContractPacketEstimateOption[]
  readonly signerContacts: readonly ProjectContractSignerOption[]
}

export type ContractPacketActionResult =
  | { readonly success: true; readonly id: string; readonly message?: string }
  | { readonly success: false; readonly error: string }

export type ContractPacketFoxitPreparationResult =
  | {
      readonly success: true
      readonly id: string
      readonly embeddedSessionUrl: string
    }
  | { readonly success: false; readonly error: string }

export type ContractPacketManualExecutionInput = {
  readonly signedAt: string | null
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly attested: boolean
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned ? cleaned : null
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function safeStringRecord(value: string): Readonly<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, item]) =>
        typeof item === "string" ? [[key, item]] : []
      )
    )
  } catch {
    return {}
  }
}

function stringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function estimateSigners(
  estimate: typeof projectEstimates.$inferSelect
): readonly ContractPacketSigner[] {
  const parsed = parsePacketSigners(estimate.clientSignersJson ?? "[]")
  if (parsed.length > 0) return parsed
  const name = cleanText(estimate.clientSignerName)
  if (!name) return []
  return [{
    contactId: estimate.clientSignerContactId,
    name,
    title: estimate.clientSignerTitle ?? "",
    email: estimate.clientSignerEmail ?? "",
    initials: signerInitials(name),
  }]
}

function packetSummary(
  row: typeof contractPackets.$inferSelect,
  includeFoxitSession: boolean
): ProjectContractPacketSummary {
  return {
    id: row.id,
    estimateId: row.estimateId,
    packetNumber: row.packetNumber,
    versionNumber: row.versionNumber,
    title: row.title,
    status: row.status,
    legalEntityName: row.legalEntityName,
    contractDraftDate: row.contractDraftDate,
    approximateCommencementDate: row.approximateCommencementDate,
    approximateCompletionDate: row.approximateCompletionDate,
    depositRateBasisPoints: row.depositRateBasisPoints,
    depositCents: row.depositCents,
    latePaymentRateBasisPoints: row.latePaymentRateBasisPoints,
    details: safeStringRecord(row.detailsJson),
    clientSigners: parsePacketSigners(row.clientSignersJson),
    companySignerName: row.companySignerName,
    companySignerTitle: row.companySignerTitle,
    companySignerEmail: row.companySignerEmail,
    companySignerInitials: row.companySignerInitials,
    foxitStatus: row.foxitStatus,
    foxitEnvelopeId: row.foxitEnvelopeId,
    foxitEmbeddedSessionUrl: includeFoxitSession
      ? row.foxitEmbeddedSessionUrl
      : null,
    signaturePackageUrl: row.signaturePackageUrl,
    signedAt: row.signedAt,
    acceptanceMethod: row.acceptanceMethod,
    acceptanceEvidenceLabel: row.acceptanceEvidenceLabel,
    acceptanceRecordedByName: row.acceptanceRecordedByName,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function packetAccess(
  projectId: string,
  update: boolean
): Promise<ContractPacketAccess> {
  const user = await requireAuth()
  requirePermission(user, "budget", update ? "update" : "read")
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Contract packet preparation is limited to internal staff.")
  }
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const projectAccess = await assertProjectAccess(db, user, projectId)
  const project = await db
    .select({
      name: projects.name,
      number: projects.projectNumber,
      address: projects.address,
      mailingAddress: projects.mailingAddress,
      clientName: projects.clientName,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project?.organizationId) throw new Error("Project organization not found.")
  const canEdit = update
  const projectNumber = project.number ?? projectAccess.projectNumber
  return {
    db,
    env,
    user,
    projectName: project.name,
    projectNumber,
    projectAddress: project.address,
    projectMailingAddress: project.mailingAddress,
    projectClientName: project.clientName,
    organizationId: project.organizationId,
    department: projectDepartment({ projectId, projectNumber }),
    canEdit,
  }
}

function revalidateContractPacket(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/contracts`)
  revalidatePath(`/print/projects/${projectId}/contract-packet`)
}

async function requireEditablePacket(
  db: CompassDb,
  projectId: string,
  packetId: string
): Promise<typeof contractPackets.$inferSelect> {
  const packet = await db
    .select()
    .from(contractPackets)
    .where(
      and(eq(contractPackets.id, packetId), eq(contractPackets.projectId, projectId))
    )
    .get()
  if (!packet) throw new Error("Contract packet not found.")
  if (!contractPacketCanBeEdited(packet.status)) {
    throw new Error(
      "This packet is frozen. Duplicate it to make contract changes."
    )
  }
  return packet
}

async function resetPreparedPacketIfNeeded(
  db: CompassDb,
  packet: typeof contractPackets.$inferSelect,
  updatedAt: string
): Promise<void> {
  if (packet.foxitStatus !== "preparing") return
  await db
    .update(contractPackets)
    .set({
      foxitStatus: "not_started",
      foxitEnvelopeId: null,
      foxitEmbeddedSessionUrl: null,
      preparedSourceHash: null,
      preparedAt: null,
      updatedAt,
    })
    .where(eq(contractPackets.id, packet.id))
    .run()
}

async function publishedTemplateOptions(
  access: ContractPacketAccess
): Promise<readonly ProjectContractTemplateOption[]> {
  const templates = await access.db
    .select()
    .from(contractDocumentTemplates)
    .where(
      and(
        eq(contractDocumentTemplates.organizationId, access.organizationId),
        eq(contractDocumentTemplates.active, true)
      )
    )
    .orderBy(asc(contractDocumentTemplates.sortOrder))
  const eligible = templates.filter((template) => {
    const departments = stringArray(template.departmentCodesJson)
    return departments.length === 0 || departments.includes(access.department)
  })
  if (eligible.length === 0) return []
  const versions = await access.db
    .select()
    .from(contractDocumentTemplateVersions)
    .where(
      and(
        inArray(contractDocumentTemplateVersions.templateId, eligible.map((item) => item.id)),
        eq(contractDocumentTemplateVersions.status, "published")
      )
    )
    .orderBy(desc(contractDocumentTemplateVersions.versionNumber))
  return eligible.flatMap((template): readonly ProjectContractTemplateOption[] => {
    const version = versions.find((item) => item.templateId === template.id)
    if (!version) return []
    return [{
      id: template.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      code: template.code,
      name: template.name,
      category: template.category,
      signingStage: template.signingStage,
      inclusionMode: template.defaultInclusionMode,
      contentMarkdown: version.contentMarkdown,
      sourceUrl: template.sourceUrl,
      sortOrder: template.sortOrder,
    }]
  })
}

export async function getProjectContractPacketWorkspace(
  projectId: string,
  packetId?: string
): Promise<ProjectContractPacketWorkspace> {
  const access = await packetAccess(projectId, false)
  const canEdit = isInternalStaffRole(access.user.role)
  const [packetRows, templates, estimateRows, contactRows] = await Promise.all([
    access.db
      .select()
      .from(contractPackets)
      .where(eq(contractPackets.projectId, projectId))
      .orderBy(desc(contractPackets.versionNumber), desc(contractPackets.updatedAt)),
    publishedTemplateOptions(access),
    access.db
      .select({
        id: projectEstimates.id,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        title: projectEstimates.title,
        status: projectEstimates.status,
        estimateDate: projectEstimates.estimateDate,
        clientName: projectEstimates.clientName,
        clientMailingAddress: projectEstimates.clientMailingAddress,
        builderFeeCents: projectEstimates.builderFeeCents,
        overheadRateBasisPoints: projectEstimates.overheadRateBasisPoints,
        marginRateBasisPoints: projectEstimates.marginRateBasisPoints,
        contingencyRateBasisPoints: projectEstimates.contingencyRateBasisPoints,
        estimateTotalCents: projectEstimates.estimateTotalCents,
      })
      .from(projectEstimates)
      .where(eq(projectEstimates.projectId, projectId))
      .orderBy(desc(projectEstimates.versionNumber)),
    access.db
      .select({
        id: projectContacts.id,
        name: projectContacts.displayName,
        title: projectContacts.role,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
        contactType: projectContacts.contactType,
      })
      .from(projectContacts)
      .where(
        and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))
      )
      .orderBy(desc(projectContacts.primaryContact), asc(projectContacts.sortOrder)),
  ])
  const active = packetRows.find((row) => row.id === packetId) ?? packetRows[0] ?? null
  const documents = active
    ? await access.db
        .select()
        .from(contractPacketDocuments)
        .where(eq(contractPacketDocuments.packetId, active.id))
        .orderBy(asc(contractPacketDocuments.sortOrder))
    : []
  return {
    canEdit,
    projectName: access.projectName,
    projectNumber: access.projectNumber,
    projectAddress: access.projectAddress,
    projectMailingAddress: access.projectMailingAddress,
    department: access.department,
    packets: packetRows.map((row) => packetSummary(row, canEdit)),
    activePacket: active ? packetSummary(active, canEdit) : null,
    documents,
    templateOptions: templates,
    estimateOptions: estimateRows.map((estimate) => ({
      id: estimate.id,
      estimateNumber: estimate.estimateNumber,
      versionNumber: estimate.versionNumber,
      title: estimate.title,
      status: estimate.status,
      estimateDate: estimate.estimateDate,
      clientName: estimate.clientName,
      clientMailingAddress: estimate.clientMailingAddress,
      builderFeeCents: estimate.builderFeeCents,
      builderFeeRateBasisPoints:
        estimate.overheadRateBasisPoints +
        estimate.marginRateBasisPoints +
        estimate.contingencyRateBasisPoints,
      estimateTotalCents: estimate.estimateTotalCents,
    })),
    signerContacts: contactRows,
  }
}

export async function createProjectContractPacket(
  projectId: string,
  estimateId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const estimate = await access.db
      .select()
      .from(projectEstimates)
      .where(
        and(eq(projectEstimates.id, estimateId), eq(projectEstimates.projectId, projectId))
      )
      .get()
    if (!estimate) throw new Error("Choose an estimate for the contract packet.")
    const templates = await publishedTemplateOptions(access)
    if (templates.length === 0) {
      throw new Error("Import and publish the Contract Library before creating a packet.")
    }
    const existing = await access.db
      .select({ versionNumber: contractPackets.versionNumber })
      .from(contractPackets)
      .where(
        and(
          eq(contractPackets.projectId, projectId),
          eq(contractPackets.packetNumber, estimate.estimateNumber)
        )
      )
      .orderBy(desc(contractPackets.versionNumber))
      .limit(1)
    const packetId = crypto.randomUUID()
    const now = new Date().toISOString()
    const versionNumber = (existing[0]?.versionNumber ?? 0) + 1
    const clientSigners = estimateSigners(estimate)
    await access.db.batch([
      access.db.insert(contractPackets).values({
        id: packetId,
        projectId,
        estimateId,
        packetNumber: estimate.estimateNumber,
        versionNumber,
        title: "Construction Contract",
        status: "draft",
        legalEntityName: projectLegalEntityName(access.department),
        contractDraftDate: new Date().toISOString().slice(0, 10),
        detailsJson: JSON.stringify({
          projectName: access.projectName,
          projectNumber: access.projectNumber ?? "",
          projectAddress: access.projectAddress ?? "",
          ownerName: estimate.clientName ?? access.projectClientName ?? "",
          ownerMailingAddress:
            estimate.clientMailingAddress ?? access.projectMailingAddress ?? "",
          county: "",
        }),
        clientSignersJson: JSON.stringify(clientSigners),
        companySignerName: estimate.companySignerName,
        companySignerTitle: estimate.companySignerTitle,
        companySignerEmail: estimate.companySignerEmail,
        companySignerInitials: estimate.companySignerInitials,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      }),
      ...templates.map((template) =>
        access.db.insert(contractPacketDocuments).values({
          id: crypto.randomUUID(),
          projectId,
          packetId,
          templateId: template.id,
          templateVersionId: template.versionId,
          code: template.code,
          title: template.name,
          contentMarkdown: template.contentMarkdown,
          inclusionMode: template.inclusionMode,
          signingStage: template.signingStage,
          signaturePolicy: template.signingStage === "contract" ? "all_signers" : "stage_signers",
          documentDate: template.code === "CA22" ? estimate.estimateDate : null,
          revision: template.code === "CA22" ? `Estimate v${estimate.versionNumber}` : `Template v${template.versionNumber}`,
          sourceUrl: template.sourceUrl,
          sortOrder: template.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
      ),
    ])
    revalidateContractPacket(projectId)
    return { success: true, id: packetId, message: `Contract packet v${versionNumber} created.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to create contract packet.",
    }
  }
}

export async function saveProjectContractPacket(
  projectId: string,
  packetId: string,
  input: {
    readonly title: string | null
    readonly legalEntityName: string | null
    readonly contractDraftDate: string | null
    readonly approximateCommencementDate: string | null
    readonly approximateCompletionDate: string | null
    readonly depositPercent: number | null
    readonly latePaymentPercent: number | null
    readonly details: Readonly<Record<string, string>>
    readonly clientSigners: readonly ContractPacketSigner[]
    readonly companySignerName: string | null
    readonly companySignerTitle: string | null
    readonly companySignerEmail: string | null
    readonly companySignerInitials: string | null
  }
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const clients = input.clientSigners.flatMap((signer): readonly ContractPacketSigner[] => {
      const name = cleanText(signer.name)
      if (!name) return []
      const email = cleanText(signer.email) ?? ""
      if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error(`Enter a valid email for ${name}.`)
      }
      return [{
        contactId: cleanText(signer.contactId),
        name,
        title: cleanText(signer.title) ?? "",
        email,
        initials: (cleanText(signer.initials) ?? signerInitials(name)).toUpperCase(),
      }]
    })
    const depositRateBasisPoints = Math.round((input.depositPercent ?? 0) * 100)
    const latePaymentRateBasisPoints = Math.round((input.latePaymentPercent ?? 0) * 100)
    if (
      !Number.isFinite(depositRateBasisPoints) ||
      depositRateBasisPoints <= 0 ||
      depositRateBasisPoints > 10_000
    ) {
      throw new Error("Deposit percentage is required and must be between 0% and 100%.")
    }
    if (
      !Number.isFinite(latePaymentRateBasisPoints) ||
      latePaymentRateBasisPoints < 0 ||
      latePaymentRateBasisPoints > 1_000_000
    ) {
      throw new Error("Late-payment rate must be between 0% and 10,000%.")
    }
    const estimate = await access.db
      .select({ estimateTotalCents: projectEstimates.estimateTotalCents })
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.id, packet.estimateId),
          eq(projectEstimates.projectId, projectId)
        )
      )
      .get()
    if (!estimate) throw new Error("The linked CA22 estimate was not found.")
    const depositCents = contractDepositCents(
      estimate.estimateTotalCents,
      depositRateBasisPoints
    )
    const now = new Date().toISOString()
    await access.db
      .update(contractPackets)
      .set({
        title: requiredText(input.title, "Packet title"),
        legalEntityName: requiredText(input.legalEntityName, "Legal entity"),
        contractDraftDate: cleanText(input.contractDraftDate),
        approximateCommencementDate: cleanText(input.approximateCommencementDate),
        approximateCompletionDate: cleanText(input.approximateCompletionDate),
        depositRateBasisPoints,
        depositCents,
        latePaymentRateBasisPoints,
        detailsJson: JSON.stringify(input.details),
        clientSignersJson: JSON.stringify(clients),
        companySignerName: cleanText(input.companySignerName),
        companySignerTitle: cleanText(input.companySignerTitle),
        companySignerEmail: cleanText(input.companySignerEmail),
        companySignerInitials: cleanText(input.companySignerInitials)?.toUpperCase() ?? null,
        updatedAt: now,
      })
      .where(eq(contractPackets.id, packetId))
      .run()
    await resetPreparedPacketIfNeeded(access.db, packet, now)
    revalidateContractPacket(projectId)
    return { success: true, id: packetId, message: "Contract packet details saved." }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save contract packet.",
    }
  }
}

export async function saveProjectContractPacketDocument(
  projectId: string,
  packetId: string,
  documentId: string,
  input: {
    readonly title: string | null
    readonly contentMarkdown: string | null
    readonly inclusionMode: string | null
    readonly signingStage: string | null
    readonly documentDate: string | null
    readonly revision: string | null
  }
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const document = await access.db
      .select()
      .from(contractPacketDocuments)
      .where(
        and(
          eq(contractPacketDocuments.id, documentId),
          eq(contractPacketDocuments.packetId, packetId),
          eq(contractPacketDocuments.projectId, projectId)
        )
      )
      .get()
    if (!document) throw new Error("Contract packet document not found.")
    const inclusionMode = input.inclusionMode
    if (inclusionMode !== "embedded" && inclusionMode !== "reference" && inclusionMode !== "generated") {
      throw new Error("Choose a supported packet treatment.")
    }
    const signingStage = input.signingStage
    if (signingStage !== "contract" && signingStage !== "construction" && signingStage !== "closeout" && signingStage !== "reference") {
      throw new Error("Choose a supported signing stage.")
    }
    await access.db
      .update(contractPacketDocuments)
      .set({
        title: requiredText(input.title, "Document title"),
        contentMarkdown: inclusionMode === "generated"
          ? document.contentMarkdown
          : requiredText(input.contentMarkdown, "Document content"),
        inclusionMode,
        signingStage,
        documentDate: cleanText(input.documentDate),
        revision: cleanText(input.revision),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(contractPacketDocuments.id, documentId))
      .run()
    await resetPreparedPacketIfNeeded(access.db, packet, new Date().toISOString())
    revalidateContractPacket(projectId)
    return { success: true, id: documentId, message: `${document.code} snapshot saved.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to save packet document.",
    }
  }
}

export async function addProjectContractPacketDocument(
  projectId: string,
  packetId: string,
  templateId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const templates = await publishedTemplateOptions(access)
    const template = templates.find((item) => item.id === templateId)
    if (!template) throw new Error("Choose a published contract document.")
    const existing = await access.db
      .select({ id: contractPacketDocuments.id })
      .from(contractPacketDocuments)
      .where(
        and(
          eq(contractPacketDocuments.packetId, packetId),
          eq(contractPacketDocuments.templateId, template.id)
        )
      )
      .get()
    if (existing) throw new Error(`${template.code} is already in this packet.`)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await access.db.insert(contractPacketDocuments).values({
      id,
      projectId,
      packetId,
      templateId: template.id,
      templateVersionId: template.versionId,
      code: template.code,
      title: template.name,
      contentMarkdown: template.contentMarkdown,
      inclusionMode: template.inclusionMode,
      signingStage: template.signingStage,
      signaturePolicy: template.signingStage === "contract" ? "all_signers" : "stage_signers",
      revision: `Template v${template.versionNumber}`,
      sourceUrl: template.sourceUrl,
      sortOrder: template.sortOrder,
      createdAt: now,
      updatedAt: now,
    }).run()
    await resetPreparedPacketIfNeeded(access.db, packet, now)
    revalidateContractPacket(projectId)
    return { success: true, id, message: `${template.code} added.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to add contract document.",
    }
  }
}

export async function deleteProjectContractPacketDocument(
  projectId: string,
  packetId: string,
  documentId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const document = await access.db
      .select({ id: contractPacketDocuments.id, code: contractPacketDocuments.code })
      .from(contractPacketDocuments)
      .where(
        and(
          eq(contractPacketDocuments.id, documentId),
          eq(contractPacketDocuments.packetId, packetId),
          eq(contractPacketDocuments.projectId, projectId)
        )
      )
      .get()
    if (!document) throw new Error("Contract packet document not found.")
    await access.db.delete(contractPacketDocuments)
      .where(eq(contractPacketDocuments.id, document.id)).run()
    await resetPreparedPacketIfNeeded(access.db, packet, new Date().toISOString())
    revalidateContractPacket(projectId)
    return { success: true, id: document.id, message: `${document.code} removed.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to remove contract document.",
    }
  }
}

export async function duplicateProjectContractPacket(
  projectId: string,
  packetId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const source = await access.db
      .select()
      .from(contractPackets)
      .where(
        and(eq(contractPackets.id, packetId), eq(contractPackets.projectId, projectId))
      )
      .get()
    if (!source) throw new Error("Contract packet not found.")
    const documents = await access.db
      .select()
      .from(contractPacketDocuments)
      .where(eq(contractPacketDocuments.packetId, source.id))
      .orderBy(asc(contractPacketDocuments.sortOrder))
    const latest = await access.db
      .select({ versionNumber: contractPackets.versionNumber })
      .from(contractPackets)
      .where(
        and(
          eq(contractPackets.projectId, projectId),
          eq(contractPackets.packetNumber, source.packetNumber)
        )
      )
      .orderBy(desc(contractPackets.versionNumber))
      .limit(1)
    const nextId = crypto.randomUUID()
    const nextVersion = (latest[0]?.versionNumber ?? source.versionNumber) + 1
    const now = new Date().toISOString()
    await access.db.batch([
      access.db.insert(contractPackets).values({
        id: nextId,
        projectId,
        estimateId: source.estimateId,
        packetNumber: source.packetNumber,
        versionNumber: nextVersion,
        title: source.title,
        status: "draft",
        legalEntityName: source.legalEntityName,
        contractDraftDate: now.slice(0, 10),
        approximateCommencementDate: source.approximateCommencementDate,
        approximateCompletionDate: source.approximateCompletionDate,
        depositRateBasisPoints: source.depositRateBasisPoints,
        depositCents: source.depositCents,
        latePaymentRateBasisPoints: source.latePaymentRateBasisPoints,
        detailsJson: source.detailsJson,
        clientSignersJson: source.clientSignersJson,
        companySignerName: source.companySignerName,
        companySignerTitle: source.companySignerTitle,
        companySignerEmail: source.companySignerEmail,
        companySignerInitials: source.companySignerInitials,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      }),
      ...documents.map((document) =>
        access.db.insert(contractPacketDocuments).values({
          id: crypto.randomUUID(),
          projectId,
          packetId: nextId,
          templateId: document.templateId,
          templateVersionId: document.templateVersionId,
          code: document.code,
          title: document.title,
          contentMarkdown: document.contentMarkdown,
          inclusionMode: document.inclusionMode,
          signingStage: document.signingStage,
          signaturePolicy: document.signaturePolicy,
          documentDate: document.documentDate,
          revision: document.revision,
          sourceUrl: document.sourceUrl,
          sortOrder: document.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
      ),
    ])
    revalidateContractPacket(projectId)
    return { success: true, id: nextId, message: `Editable packet v${nextVersion} created.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to duplicate contract packet.",
    }
  }
}

export async function deleteProjectContractPacket(
  projectId: string,
  packetId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    await access.db.delete(contractPackets).where(eq(contractPackets.id, packet.id)).run()
    revalidateContractPacket(projectId)
    return { success: true, id: packet.id, message: "Draft contract packet deleted." }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to delete contract packet.",
    }
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

async function renderContractEstimatePdf(input: {
  readonly env: CloudflareEnv
  readonly projectId: string
  readonly estimateId: string
}): Promise<ArrayBuffer> {
  const quickAction = Reflect.get(input.env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    throw new Error("Cloudflare Browser Run is not available for contract PDFs.")
  }
  const origin = new URL(input.env.WORKOS_REDIRECT_URI).origin
  const url = new URL(`/print/projects/${input.projectId}/estimate`, origin)
  url.searchParams.set("estimateId", input.estimateId)
  const requestCookies = await cookies()
  const rendered: unknown = await Reflect.apply(quickAction, input.env.BROWSER, [
    "pdf",
    {
      url: url.toString(),
      setExtraHTTPHeaders: { Cookie: requestCookies.toString() },
      gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
      waitForSelector: { selector: ".estimate-signature-page", timeout: 60_000 },
      pdfOptions: {
        format: "letter",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      },
    },
  ])
  if (!(rendered instanceof Response) || !rendered.ok) {
    throw new Error("Unable to render the selected CA22 estimate.")
  }
  return rendered.arrayBuffer()
}

export async function prepareProjectContractPacketForSignature(
  projectId: string,
  packetId: string
): Promise<ContractPacketFoxitPreparationResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const workspace = await getProjectContractPacketWorkspace(projectId, packetId)
    const estimate = workspace.estimateOptions.find(
      (item) => item.id === packet.estimateId
    )
    if (!estimate) throw new Error("The linked CA22 estimate was not found.")
    if (!cleanText(packet.contractDraftDate)) {
      throw new Error("Add the contract date before signature.")
    }
    if (!cleanText(packet.approximateCommencementDate)) {
      throw new Error("Add the approximate commencement date before signature.")
    }
    if (!cleanText(packet.approximateCompletionDate)) {
      throw new Error("Add the approximate completion date before signature.")
    }
    const details = safeStringRecord(packet.detailsJson)
    if (!cleanText(details.projectAddress ?? null)) {
      throw new Error("Add the project location before signature.")
    }
    if (!cleanText(details.county ?? null)) {
      throw new Error("Add the project county before signature.")
    }
    if (!cleanText(details.ownerName ?? null)) {
      throw new Error("Add the owner or client name before signature.")
    }
    const clients = parsePacketSigners(packet.clientSignersJson)
    if (clients.length === 0) {
      throw new Error("Add at least one owner signer before signature.")
    }
    for (const signer of clients) {
      if (!cleanText(signer.email)) {
        throw new Error(`Add an email address for ${signer.name}.`)
      }
      if (!cleanText(signer.initials)) {
        throw new Error(`Add initials for ${signer.name}.`)
      }
    }
    if (!cleanText(packet.companySignerName)) {
      throw new Error("Choose or type the company representative before signature.")
    }
    if (!cleanText(packet.companySignerEmail)) {
      throw new Error("Add the company representative email before signature.")
    }
    if (!cleanText(packet.companySignerTitle)) {
      throw new Error("Add the company representative title before signature.")
    }
    if (!cleanText(packet.companySignerInitials)) {
      throw new Error("Add the company representative initials before signature.")
    }
    if (
      packet.depositRateBasisPoints <= 0 ||
      packet.depositRateBasisPoints > 10_000
    ) {
      throw new Error("Add a deposit percentage between 0% and 100% before signature.")
    }
    const expectedDepositCents = contractDepositCents(
      estimate.estimateTotalCents,
      packet.depositRateBasisPoints
    )
    if (packet.depositCents !== expectedDepositCents) {
      throw new Error("Save the contract information again so the deposit matches the estimate total.")
    }
    const sourceHash = await sha256(JSON.stringify({
      packet: packetSummary(packet, false),
      documents: workspace.documents,
      estimate,
    }))
    const clientId = cleanText(access.env.FOXIT_ESIGN_CLIENT_ID)
    const clientSecret = cleanText(access.env.FOXIT_ESIGN_CLIENT_SECRET)
    if (!clientId || !clientSecret) {
      throw new Error("Foxit eSign credentials are not configured for Compass.")
    }
    const origin = new URL(access.env.WORKOS_REDIRECT_URI).origin
    const assets = access.env.ASSETS
    if (!assets) throw new Error("Cloudflare Assets is unavailable for contract branding.")
    const [estimatePdf, brand] = await Promise.all([
      renderContractEstimatePdf({
        env: access.env,
        projectId,
        estimateId: estimate.id,
      }),
      loadContractPacketPdfBranding({
        assets,
        origin,
        projectId,
        projectNumber: workspace.projectNumber,
      }),
    ])
    const prepared = await prepareContractPacketPdf({
      packet: packetSummary(packet, false),
      documents: workspace.documents,
      estimate,
      projectName: workspace.projectName,
      projectNumber: workspace.projectNumber,
      projectAddress: workspace.projectAddress,
      brand,
      estimatePdf,
    })
    const successUrl = new URL(`/dashboard/projects/${projectId}/contracts`, origin)
    successUrl.searchParams.set("packetId", packetId)
    successUrl.searchParams.set("foxit", "sent")
    const errorUrl = new URL(successUrl)
    errorUrl.searchParams.set("foxit", "error")
    const parties = [
      ...clients.map((signer, index) => ({
        name: signer.name,
        email: signer.email,
        sequence: index + 1,
      })),
      {
        name: packet.companySignerName ?? "Company representative",
        email: packet.companySignerEmail ?? "",
        sequence: clients.length + 1,
      },
    ]
    const foxit = await createFoxitPreparedEnvelope({
      clientId,
      clientSecret,
      folderName: `${packet.packetNumber} contract version ${packet.versionNumber}`,
      pdfBase64: prepared.pdfBase64,
      parties,
      fields: prepared.fields,
      successUrl: successUrl.toString(),
      errorUrl: errorUrl.toString(),
      estimateId: packet.estimateId,
      contractPacketId: packet.id,
      sourceHash,
    })
    const now = new Date().toISOString()
    await access.db
      .update(contractPackets)
      .set({
        foxitStatus: "preparing",
        foxitEnvelopeId: foxit.envelopeId,
        foxitEmbeddedSessionUrl: foxit.embeddedSessionUrl,
        preparedSourceHash: sourceHash,
        preparedAt: now,
        updatedAt: now,
      })
      .where(eq(contractPackets.id, packet.id))
      .run()
    revalidateContractPacket(projectId)
    return {
      success: true,
      id: packet.id,
      embeddedSessionUrl: foxit.embeddedSessionUrl,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to prepare contract signature.",
    }
  }
}

export async function markProjectContractPacketSentOutsideCompass(
  projectId: string,
  packetId: string
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await requireEditablePacket(access.db, projectId, packetId)
    const documents = await access.db
      .select()
      .from(contractPacketDocuments)
      .where(eq(contractPacketDocuments.packetId, packet.id))
      .orderBy(asc(contractPacketDocuments.sortOrder))
    if (!documents.some((item) => item.code === "CA00")) {
      throw new Error("Add CA00 before sending the contract packet.")
    }
    if (!documents.some((item) => item.code === "CA22")) {
      throw new Error("Add CA22 before sending the contract packet.")
    }
    if (!packet.contractDraftDate || !packet.approximateCommencementDate || !packet.approximateCompletionDate) {
      throw new Error("Add the required contract and approximate construction dates.")
    }
    const details = safeStringRecord(packet.detailsJson)
    if (!details.projectAddress || !details.county || !details.ownerName) {
      throw new Error("Add the required project location, county, and owner name.")
    }
    const clients = parsePacketSigners(packet.clientSignersJson)
    if (clients.length === 0 || clients.some((signer) => !signer.name)) {
      throw new Error("Add at least one owner signer.")
    }
    if (!packet.companySignerName) {
      throw new Error("Add the company representative.")
    }
    const sourceHash = await sha256(JSON.stringify({ packet, documents }))
    const now = new Date().toISOString()
    await access.db.batch([
      access.db
        .update(contractPackets)
        .set({
          status: "signature_pending",
          foxitStatus: "not_applicable",
          foxitEnvelopeId: null,
          foxitEmbeddedSessionUrl: null,
          signatureRequestedAt: now,
          sourceHash,
          updatedAt: now,
        })
        .where(eq(contractPackets.id, packet.id)),
      access.db
        .update(projectEstimates)
        .set({
          status: "signature_pending",
          foxitStatus: "included_in_manual_contract_packet",
          signatureRequestedAt: now,
          updatedAt: now,
        })
        .where(eq(projectEstimates.id, packet.estimateId)),
    ])
    revalidateContractPacket(projectId)
    return { success: true, id: packet.id, message: "Packet frozen for outside signatures." }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to freeze the contract packet.",
    }
  }
}

export async function recordManualProjectContractPacketExecution(
  projectId: string,
  packetId: string,
  input: ContractPacketManualExecutionInput
): Promise<ContractPacketActionResult> {
  try {
    const access = await packetAccess(projectId, true)
    const packet = await access.db
      .select()
      .from(contractPackets)
      .where(
        and(eq(contractPackets.id, packetId), eq(contractPackets.projectId, projectId))
      )
      .get()
    if (!packet || packet.status !== "signature_pending") {
      throw new Error("Send or print the final packet for signature before recording execution.")
    }
    if (!input.attested) {
      throw new Error("Confirm that every required owner and company representative signed the complete packet.")
    }
    const evidenceUrl = cleanText(input.evidenceUrl)
    if (!evidenceUrl) throw new Error("Upload or link the saved signed packet.")
    const url = new URL(evidenceUrl)
    if (url.protocol !== "https:") {
      throw new Error("The signed packet must use a secure HTTPS link.")
    }
    const evidenceLabel = requiredText(input.evidenceLabel, "Signed packet label")
    const signedDate = requiredText(input.signedAt, "Contract execution date")
    const signedAt = new Date(`${signedDate.slice(0, 10)}T12:00:00Z`)
    if (Number.isNaN(signedAt.valueOf()) || signedAt > new Date()) {
      throw new Error("Choose a valid contract execution date that is not in the future.")
    }
    const now = new Date().toISOString()
    const signedAtIso = signedAt.toISOString()
    await access.db.batch([
      access.db
        .update(contractPackets)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(contractPackets.projectId, projectId),
            eq(contractPackets.status, "executed"),
            ne(contractPackets.id, packet.id)
          )
        ),
      access.db
        .update(projectEstimates)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(projectEstimates.projectId, projectId),
            eq(projectEstimates.status, "accepted")
          )
        ),
      access.db
        .update(contractPackets)
        .set({
          status: "executed",
          foxitStatus: "not_applicable",
          signaturePackageUrl: url.toString(),
          signedAt: signedAtIso,
          acceptanceMethod: "manual",
          acceptanceEvidenceLabel: evidenceLabel,
          acceptanceRecordedByName: access.user.displayName ?? access.user.email,
          acceptedAt: now,
          acceptedBy: access.user.id,
          updatedAt: now,
        })
        .where(eq(contractPackets.id, packet.id)),
      access.db
        .update(projectEstimates)
        .set({
          status: "accepted",
          foxitStatus: "completed_in_manual_contract_packet",
          signaturePackageUrl: url.toString(),
          signedAt: signedAtIso,
          acceptanceMethod: "manual_contract_packet",
          acceptanceEvidenceLabel: evidenceLabel,
          acceptanceRecordedByName: access.user.displayName ?? access.user.email,
          acceptedAt: now,
          acceptedBy: access.user.id,
          sageStatus: "ready",
          updatedAt: now,
        })
        .where(eq(projectEstimates.id, packet.estimateId)),
    ])
    const budget = await rebuildProjectContractBudget({
      db: access.db,
      projectId,
      actorUserId: access.user.id,
    })
    revalidateContractPacket(projectId)
    if (!budget.success) {
      return {
        success: false,
        error: `Contract executed, but the budget needs review: ${budget.error}`,
      }
    }
    return { success: true, id: packet.id, message: "Manually signed contract packet recorded and locked." }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to record contract execution.",
    }
  }
}
