import { and, desc, eq, inArray } from "drizzle-orm"

import { projectContacts } from "@/db/schema"
import { projectDocuments } from "@/db/schema-documents"
import {
  estimateTermsTemplates,
  projectEstimateAcknowledgements,
  projectEstimateBasisDocuments,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import type { CompassDb, EstimateAccess } from "@/lib/domain/estimates/access"
import { limitedText, requiredText, safeUrl, signerInitials } from "@/lib/domain/estimates/rules"
import {
  deleteEstimateAcknowledgements,
  deleteEstimateBasisDocuments,
  deleteEstimatePhaseDescriptions,
  insertEstimateAcknowledgement,
  insertEstimateBasisDocument,
  updateEstimates,
  upsertEstimatePhaseDescription,
} from "@/lib/domain/estimates/store"
import { normalizeEstimateSigner, templateDepartment } from "@/lib/domain/estimates/summaries"
import type {
  ProjectEstimateBasisInput,
  ProjectEstimateHeaderInput,
  ProjectEstimateSigner,
} from "@/lib/domain/estimates/types"
import {
  builtInEstimateTextTemplates,
  isEstimateClientReportMode,
  type EstimateTextTemplateOption,
  type EstimateTextTemplateType,
} from "@/lib/estimates/client-report"
import type { ProjectDepartment } from "@/lib/project-branding"
import { cleanText } from "@/lib/shared/guards"

/**
 * The estimate's header, report settings, phase descriptions,
 * acknowledgements and basis documents. Callers check access and that the
 * estimate is editable first.
 */

async function validatedSignerContactId(
  db: CompassDb,
  projectId: string,
  contactId: string | null,
  label: string
): Promise<string | null> {
  const cleaned = cleanText(contactId)
  if (!cleaned) return null
  const rows = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.id, cleaned),
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.active, true)
      )
    )
    .limit(1)
  if (!rows[0]) throw new Error(`Choose an active project contact for ${label}.`)
  return cleaned
}

async function loadEstimateTextTemplate(input: {
  readonly db: CompassDb
  readonly organizationId: string | null
  readonly department: ProjectDepartment
  readonly templateId: string | null
  readonly templateType: EstimateTextTemplateType
}): Promise<{ readonly id: string | null; readonly body: string } | null> {
  if (!input.templateId) return null
  const builtInTemplate = builtInEstimateTextTemplates({
    department: input.department,
    templateType: input.templateType,
  }).find((template) => template.id === input.templateId)
  if (builtInTemplate) {
    // Built-ins are code-backed rather than database rows, so only snapshot
    // their body onto the estimate and leave the foreign key unset.
    return { id: null, body: builtInTemplate.body }
  }
  if (!input.organizationId) {
    throw new Error("The project organization is required for text templates.")
  }
  const rows = await input.db
    .select()
    .from(estimateTermsTemplates)
    .where(
      and(
        eq(estimateTermsTemplates.id, input.templateId),
        eq(estimateTermsTemplates.organizationId, input.organizationId),
        eq(estimateTermsTemplates.active, true)
      )
    )
    .limit(1)
  const template = rows[0]
  if (
    !template ||
    template.templateType !== input.templateType ||
    (template.departmentCode !== null &&
      template.departmentCode !== input.department)
  ) {
    throw new Error(`Choose an available ${input.templateType} template.`)
  }
  return template
}

export async function updateEstimateHeader(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  input: ProjectEstimateHeaderInput
): Promise<void> {
  const taxEntityRows = input.defaultTaxEntityId
    ? await access.db
        .select()
        .from(sageTaxEntities)
        .where(and(eq(sageTaxEntities.id, input.defaultTaxEntityId), eq(sageTaxEntities.active, true)))
        .limit(1)
    : []
  const taxEntity = taxEntityRows[0]
  if (input.defaultTaxEntityId && !taxEntity) {
    throw new Error("Choose an active Sage tax entity.")
  }
  const templateFor = (templateId: string | null, templateType: EstimateTextTemplateType) =>
    loadEstimateTextTemplate({
      db: access.db,
      organizationId: access.organizationId,
      department: access.department,
      templateId,
      templateType,
    })
  const [termsTemplate, introductionTemplate, closingTemplate] = await Promise.all([
    templateFor(input.termsTemplateId, "terms"),
    templateFor(input.introductionTemplateId, "introduction"),
    templateFor(input.closingTemplateId, "closing"),
  ])
  const contractTerms = cleanText(input.contractTerms) ?? termsTemplate?.body ?? null
  const introductionText = cleanText(input.introductionText) ?? introductionTemplate?.body ?? null
  const closingText = cleanText(input.closingText) ?? closingTemplate?.body ?? null
  const clientSigners = input.clientSigners.flatMap(
    (signer): readonly ProjectEstimateSigner[] => {
      const normalized = normalizeEstimateSigner(signer)
      return normalized ? [normalized] : []
    }
  )
  if (clientSigners.length > 10) {
    throw new Error("An estimate can have no more than 10 client signers.")
  }
  const validatedClientContactIds = await Promise.all(
    clientSigners.map((signer) =>
      validatedSignerContactId(access.db, projectId, signer.contactId, `client signer ${signer.name}`)
    )
  )
  const savedClientSigners = clientSigners.map((signer, index) => ({
    ...signer,
    contactId: validatedClientContactIds[index] ?? null,
  }))
  const primaryClientSigner = savedClientSigners[0]
  const companySignerContactId = await validatedSignerContactId(
    access.db,
    projectId,
    input.companySignerContactId,
    "the company representative"
  )
  await updateEstimates(access.db, eq(projectEstimates.id, estimateId), {
    estimateNumber: requiredText(input.estimateNumber, "Estimate number"),
    title: requiredText(input.title, "Estimate title"),
    estimateDate: requiredText(input.estimateDate, "Estimate date"),
    clientName: cleanText(input.clientName),
    clientMailingAddress: cleanText(input.clientMailingAddress),
    clientSignerContactId: primaryClientSigner?.contactId ?? null,
    clientSignerName: primaryClientSigner?.name ?? null,
    clientSignerTitle: primaryClientSigner?.title || null,
    clientSignerEmail: primaryClientSigner?.email || null,
    clientSignersJson: JSON.stringify(savedClientSigners),
    companySignerContactId,
    companySignerName: limitedText(input.companySignerName, "Company representative name", 200),
    companySignerTitle: limitedText(input.companySignerTitle, "Company representative title", 200),
    companySignerEmail: limitedText(input.companySignerEmail, "Company representative email", 320),
    companySignerInitials:
      limitedText(input.companySignerInitials, "Company representative initials", 6) ??
      (cleanText(input.companySignerName)
        ? signerInitials(requiredText(input.companySignerName, "Company representative name"))
        : null),
    sourceWorkbookUrl: safeUrl(input.sourceWorkbookUrl),
    defaultTaxEntityId: taxEntity?.id ?? null,
    defaultTaxCode: taxEntity?.code ?? null,
    defaultTaxName: taxEntity?.name ?? null,
    defaultTaxRateBasisPoints: taxEntity?.rateBasisPoints ?? 0,
    termsTemplateId: termsTemplate?.id ?? null,
    contractTerms,
    introductionTemplateId: introductionTemplate?.id ?? null,
    introductionText,
    closingTemplateId: closingTemplate?.id ?? null,
    closingText,
    updatedAt: new Date().toISOString(),
  })
}

export async function setEstimateClientReportMode(
  access: EstimateAccess,
  estimateId: string,
  mode: string,
  showAssemblyBuilderFee: boolean | undefined,
  showCostBreakdowns: boolean | undefined
): Promise<void> {
  if (!isEstimateClientReportMode(mode)) {
    throw new Error("Choose an available client report view.")
  }
  if (showAssemblyBuilderFee !== undefined && typeof showAssemblyBuilderFee !== "boolean") {
    throw new Error("Choose whether to show assembly builder fees.")
  }
  if (showCostBreakdowns !== undefined && typeof showCostBreakdowns !== "boolean") {
    throw new Error("Choose whether to show cost breakdowns.")
  }
  await updateEstimates(access.db, eq(projectEstimates.id, estimateId), {
    clientReportMode: mode,
    showAssemblyBuilderFee,
    showCostBreakdowns,
    updatedAt: new Date().toISOString(),
  })
}

/** Saves a phase's description, or removes it when it is blank. */
export async function saveEstimatePhaseDescription(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  input: { readonly divisionCode: string | null; readonly description: string | null }
): Promise<void> {
  const divisionCode = requiredText(input.divisionCode, "Phase")
  const matchingLine = await access.db
    .select({ id: projectEstimateLines.id })
    .from(projectEstimateLines)
    .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.divisionCode, divisionCode)))
    .limit(1)
  if (!matchingLine[0]) {
    throw new Error("Choose a phase used by this estimate.")
  }
  const description = cleanText(input.description)
  if (!description) {
    await deleteEstimatePhaseDescriptions(
      access.db,
      and(
        eq(projectEstimatePhaseDescriptions.estimateId, estimateId),
        eq(projectEstimatePhaseDescriptions.divisionCode, divisionCode)
      )
    )
    return
  }
  const now = new Date().toISOString()
  await upsertEstimatePhaseDescription(access.db, {
    id: crypto.randomUUID(),
    projectId,
    estimateId,
    divisionCode,
    description,
    createdAt: now,
    updatedAt: now,
  })
}

/** Replaces the estimate's acknowledgements (Nu-Tech) with the chosen templates. */
export async function setEstimateAcknowledgements(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  templateIds: readonly string[]
): Promise<void> {
  if (access.department !== "N") {
    throw new Error("Acknowledgements are available for Nu-Tech estimates.")
  }
  const uniqueTemplateIds = [...new Set(templateIds)].slice(0, 10)
  const databaseRows = access.organizationId
    ? await access.db
        .select()
        .from(estimateTermsTemplates)
        .where(
          and(
            eq(estimateTermsTemplates.organizationId, access.organizationId),
            eq(estimateTermsTemplates.active, true),
            eq(estimateTermsTemplates.templateType, "acknowledgement")
          )
        )
    : []
  const databaseTemplates = databaseRows.flatMap(
    (row): readonly EstimateTextTemplateOption[] => {
      const departmentCode = templateDepartment(row.departmentCode)
      if (departmentCode !== null && departmentCode !== access.department) {
        return []
      }
      return [
        {
          id: row.id,
          name: row.name,
          departmentCode,
          templateType: "acknowledgement",
          body: row.body,
          sourceDocumentId: row.sourceDocumentId,
          sourceUrl: row.sourceUrl,
        },
      ]
    }
  )
  const availableTemplates = [
    ...databaseTemplates,
    ...builtInEstimateTextTemplates({ department: access.department, templateType: "acknowledgement" }),
  ]
  const selectedTemplates = uniqueTemplateIds.map((templateId) => {
    const template = availableTemplates.find((candidate) => candidate.id === templateId)
    if (!template) throw new Error("Choose an available acknowledgement.")
    return template
  })
  const now = new Date().toISOString()
  await deleteEstimateAcknowledgements(access.db, eq(projectEstimateAcknowledgements.estimateId, estimateId))
  if (selectedTemplates.length > 0) {
    await insertEstimateAcknowledgement(
      access.db,
      selectedTemplates.map((template, sortOrder) => ({
        id: crypto.randomUUID(),
        projectId,
        estimateId,
        templateId: template.id,
        title: template.name,
        body: template.body,
        sourceDocumentId: template.sourceDocumentId,
        sourceUrl: template.sourceUrl,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      }))
    )
  }
}

/** Adds a basis document, linked to a published project document or typed in. Returns its id. */
export async function addEstimateBasisDocument(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBasisInput
): Promise<string> {
  const requestedProjectDocumentId = cleanText(input.projectDocumentId)
  const linkedDocument = requestedProjectDocumentId
    ? await access.db
        .select()
        .from(projectDocuments)
        .where(
          and(
            eq(projectDocuments.id, requestedProjectDocumentId),
            eq(projectDocuments.projectId, projectId),
            inArray(projectDocuments.status, ["current", "superseded"])
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null
  if (requestedProjectDocumentId && !linkedDocument) {
    throw new Error("Choose a published document from this project.")
  }
  const prior = await access.db
    .select({ sortOrder: projectEstimateBasisDocuments.sortOrder })
    .from(projectEstimateBasisDocuments)
    .where(eq(projectEstimateBasisDocuments.estimateId, estimateId))
    .orderBy(desc(projectEstimateBasisDocuments.sortOrder))
    .limit(1)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await insertEstimateBasisDocument(access.db, {
    id,
    projectId,
    estimateId,
    projectDocumentId: linkedDocument?.id ?? null,
    documentType: linkedDocument?.category ?? requiredText(input.documentType, "Document type"),
    title: linkedDocument?.title ?? requiredText(input.title, "Document title"),
    documentDate: linkedDocument?.documentDate ?? cleanText(input.documentDate),
    revision: linkedDocument?.revision ?? cleanText(input.revision),
    driveFileId: linkedDocument?.sourceDriveFileId ?? null,
    driveUrl: linkedDocument?.sourceUrl ?? safeUrl(input.driveUrl),
    notes: cleanText(input.notes),
    sortOrder: (prior[0]?.sortOrder ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function deleteEstimateBasisDocument(
  access: EstimateAccess,
  projectId: string,
  estimateId: string,
  documentId: string
): Promise<void> {
  const where = and(
    eq(projectEstimateBasisDocuments.id, documentId),
    eq(projectEstimateBasisDocuments.projectId, projectId),
    eq(projectEstimateBasisDocuments.estimateId, estimateId)
  )
  const documents = await access.db
    .select({ id: projectEstimateBasisDocuments.id })
    .from(projectEstimateBasisDocuments)
    .where(where)
    .limit(1)
  if (!documents[0]) {
    throw new Error("Estimate basis document not found.")
  }
  await deleteEstimateBasisDocuments(access.db, where)
}
