import { and, asc, eq, isNull } from "drizzle-orm"
import { cookies } from "next/headers"

import {
  projectEstimateAcknowledgements,
  projectEstimateAssemblies,
  projectEstimateBasisDocuments,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import type { EstimateAccess } from "@/lib/domain/estimates/access"
import { updateEstimates } from "@/lib/domain/estimates/store"
import { projectEstimateClientSigners } from "@/lib/domain/estimates/summaries"
import {
  estimateClientReportMode,
  estimateTitleForDepartment,
  isEstimateClientReportMode,
} from "@/lib/estimates/client-report"
import { unpricedLinesMessage } from "@/lib/estimates/pricing-sources"
import {
  prepareEstimateSignaturePdf,
  type PreparedEstimateSignaturePdf,
} from "@/lib/estimates/signature-pdf"
import { estimateSourceHash } from "@/lib/financials/estimate-ledger"
import { createFoxitPreparedEnvelope } from "@/lib/foxit/esign"
import { cleanText } from "@/lib/shared/guards"

/**
 * Sending an estimate for signature: through Foxit eSign, or frozen for
 * signatures collected outside Compass. Callers check access and pass the
 * editable estimate.
 */

type EstimateRow = typeof projectEstimates.$inferSelect

async function renderEstimateSignaturePdf(input: {
  readonly env: CloudflareEnv
  readonly projectId: string
  readonly estimateId: string
  readonly signerLabels: readonly string[]
  readonly corporateSignerIndex: number
}): Promise<PreparedEstimateSignaturePdf> {
  const quickAction = Reflect.get(input.env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    throw new Error("Cloudflare Browser Run is not available for estimate PDFs.")
  }
  const requestCookies = await cookies()
  const origin = new URL(input.env.WORKOS_REDIRECT_URI).origin
  const url = new URL(`/print/projects/${input.projectId}/estimate`, origin)
  url.searchParams.set("estimateId", input.estimateId)
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
    throw new Error("Unable to render the estimate signature PDF.")
  }
  return prepareEstimateSignaturePdf({
    pdf: await rendered.arrayBuffer(),
    signerLabels: input.signerLabels,
    corporateSignerIndex: input.corporateSignerIndex,
  })
}

/** Prepares a Foxit envelope for the estimate. Returns the embedded signing session. */
export async function prepareEstimateForClientSignature(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow
): Promise<string> {
  const estimateId = estimate.id
  const [
    lines,
    costItems,
    basisDocuments,
    phaseDescriptions,
    reportPhases,
    acknowledgements,
    assemblies,
  ] =
    await Promise.all([
      access.db
        .select()
        .from(projectEstimateLines)
        .where(eq(projectEstimateLines.estimateId, estimateId))
        .orderBy(asc(projectEstimateLines.sortOrder)),
      access.db
        .select()
        .from(projectEstimateLineCostItems)
        .where(
          and(
            eq(projectEstimateLineCostItems.estimateId, estimateId),
            isNull(projectEstimateLineCostItems.deletedAt)
          )
        )
        .orderBy(
          asc(projectEstimateLineCostItems.estimateLineId),
          asc(projectEstimateLineCostItems.sortOrder)
        ),
      access.db
        .select()
        .from(projectEstimateBasisDocuments)
        .where(eq(projectEstimateBasisDocuments.estimateId, estimateId))
        .orderBy(asc(projectEstimateBasisDocuments.sortOrder)),
      access.db
        .select()
        .from(projectEstimatePhaseDescriptions)
        .where(eq(projectEstimatePhaseDescriptions.estimateId, estimateId))
        .orderBy(asc(projectEstimatePhaseDescriptions.divisionCode)),
      access.db.select().from(projectEstimateReportPhases)
        .where(eq(projectEstimateReportPhases.estimateId, estimateId))
        .orderBy(asc(projectEstimateReportPhases.sortOrder), asc(projectEstimateReportPhases.id)),
      access.db
        .select()
        .from(projectEstimateAcknowledgements)
        .where(eq(projectEstimateAcknowledgements.estimateId, estimateId))
        .orderBy(asc(projectEstimateAcknowledgements.sortOrder)),
      access.db.select().from(projectEstimateAssemblies)
        .where(eq(projectEstimateAssemblies.estimateId, estimateId))
        .orderBy(asc(projectEstimateAssemblies.sortOrder)),
    ])
  if (lines.length === 0) throw new Error("Add estimate lines before signature.")
  const unpriced = unpricedLinesMessage(lines)
  if (unpriced) throw new Error(unpriced)
  if (!cleanText(estimate.estimateDate)) {
    throw new Error("Add the estimate date before signature.")
  }
  const clientSigners = projectEstimateClientSigners(estimate)
  if (clientSigners.length === 0) {
    throw new Error("Add at least one client or owner signer before signature.")
  }
  if (clientSigners.some((signer) => !cleanText(signer.email))) {
    throw new Error("Every client or owner signer needs an email address for Foxit.")
  }
  if (!cleanText(estimate.companySignerName)) {
    throw new Error(
      "Choose or type the company representative before signature."
    )
  }
  if (!cleanText(estimate.companySignerTitle)) {
    throw new Error("Add the company representative title before signature.")
  }
  if (!cleanText(estimate.companySignerEmail)) {
    throw new Error("Add the company representative email before signature.")
  }
  const sourceCostCodes = [
    ...new Set(
      lines
        .filter((line) => line.divisionCode !== "99")
        .map((line) => line.costCode)
    ),
  ]
  const costCodeCatalog = await loadProjectCostCodeCatalog(access.db)
  const activeCostCodes = new Set(
    costCodeCatalog.filter((row) => row.sageMapped).map((row) => row.code)
  )
  const missingCostCodes = sourceCostCodes.filter(
    (code) => !activeCostCodes.has(code)
  )
  if (missingCostCodes.length > 0) {
    throw new Error(
      `${missingCostCodes.length} estimate cost codes require Sage mapping before signature handoff: ${missingCostCodes.join(", ")}.`
    )
  }
  if (!cleanText(estimate.contractTerms)) {
    throw new Error("Add the contract terms before signature.")
  }
  const reportTitle = estimateTitleForDepartment({
    department: access.department,
    requestedTitle: estimate.title,
  })
  const costItemsByLineId = new Map<
    string,
    (typeof costItems)[number][]
  >()
  for (const item of costItems) {
    const current = costItemsByLineId.get(item.estimateLineId) ?? []
    current.push(item)
    costItemsByLineId.set(item.estimateLineId, current)
  }
  const sourceHash = await estimateSourceHash({
    // clientDetail joins the hash only when set, so estimates prepared before
    // it existed keep their hash.
    assemblies: assemblies.map(({ id, name, description, sortOrder, clientDetail }) => ({ id, name, description, sortOrder, ...(clientDetail ? { clientDetail } : {}) })),
    estimateId,
    versionNumber: estimate.versionNumber,
    title: reportTitle,
    showAssemblyBuilderFee: estimate.showAssemblyBuilderFee,
    showCostBreakdowns: estimate.showCostBreakdowns,
    reportMode: isEstimateClientReportMode(estimate.clientReportMode)
      ? estimate.clientReportMode
      : estimateClientReportMode(access.department),
    projectName: access.projectName,
    projectAddress: access.projectAddress,
    clientName: estimate.clientName,
    clientMailingAddress: estimate.clientMailingAddress,
    introductionText: estimate.introductionText,
    contractTerms: estimate.contractTerms,
    closingText: estimate.closingText,
    signers: {
      clients: projectEstimateClientSigners(estimate).map((signer) => ({
        name: signer.name,
        title: signer.title,
        email: signer.email,
        initials: signer.initials,
      })),
      company: {
        name: estimate.companySignerName,
        title: estimate.companySignerTitle,
        email: estimate.companySignerEmail,
        initials: estimate.companySignerInitials,
      },
    },
    overheadRateBasisPoints: estimate.overheadRateBasisPoints,
    marginRateBasisPoints: estimate.marginRateBasisPoints,
    contingencyRateBasisPoints: estimate.contingencyRateBasisPoints,
    lines: lines.map((line) => ({
      id: line.id,
      reportPhaseId: line.reportPhaseId,
      divisionCode: line.divisionCode,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: line.specifications,
      quantity: line.quantity,
      unit: line.unit,
      assemblyId: line.assemblyId,
      unitCostCents: line.unitCostCents,
      markupRateBasisPoints: line.markupRateBasisPoints,
      taxable: line.taxable,
      taxCode: line.taxCode,
      taxName: line.taxName,
      taxRateBasisPoints: line.taxRateBasisPoints,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
      ownerVisible: line.ownerVisible,
      includeInBuilderFee: line.includeInBuilderFee,
      sortOrder: line.sortOrder,
      costItems: (costItemsByLineId.get(line.id) ?? []).map((item) => ({
        id: item.id,
        costCode: item.costCode,
        costCodeName: item.costCodeName,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
        taxCode: item.taxCode,
        taxName: item.taxName,
        taxRateBasisPoints: item.taxRateBasisPoints,
        taxCents: item.taxCents,
        lineTotalCents: item.lineTotalCents,
        sortOrder: item.sortOrder,
      })),
    })),
    basisDocuments: basisDocuments.map((document) => ({
      id: document.id,
      projectDocumentId: document.projectDocumentId,
      documentType: document.documentType,
      title: document.title,
      documentDate: document.documentDate,
      revision: document.revision,
      driveFileId: document.driveFileId,
      driveUrl: document.driveUrl,
      notes: document.notes,
      sortOrder: document.sortOrder,
    })),
    phaseDescriptions: phaseDescriptions.map((phase) => ({
      divisionCode: phase.divisionCode,
      description: phase.description,
    })),
    reportPhases: reportPhases.map((phase) => ({
      id: phase.id, divisionCode: phase.divisionCode, name: phase.name,
      description: phase.description, itemize: phase.itemize, sortOrder: phase.sortOrder,
    })),
    acknowledgements: acknowledgements.map((acknowledgement) => ({
      templateId: acknowledgement.templateId,
      title: acknowledgement.title,
      body: acknowledgement.body,
      sortOrder: acknowledgement.sortOrder,
    })),
  })
  const env = access.env
  const clientId = cleanText(env.FOXIT_ESIGN_CLIENT_ID)
  const clientSecret = cleanText(env.FOXIT_ESIGN_CLIENT_SECRET)
  if (!clientId || !clientSecret) {
    throw new Error("Foxit eSign credentials are not configured for Compass.")
  }
  const preparedPdf = await renderEstimateSignaturePdf({
    env,
    projectId,
    estimateId,
    signerLabels: [
      ...clientSigners.map((_, index) => `Client ${index + 1}`),
      "Company",
    ],
    corporateSignerIndex: clientSigners.length,
  })
  const origin = new URL(env.WORKOS_REDIRECT_URI).origin
  const returnUrl = new URL(
    `/dashboard/projects/${projectId}/estimate`,
    origin
  )
  returnUrl.searchParams.set("estimateId", estimateId)
  const failureUrl = new URL(returnUrl)
  failureUrl.searchParams.set("foxit", "error")
  returnUrl.searchParams.set("foxit", "sent")
  const parties = [
    ...clientSigners.map((signer, index) => ({
      name: signer.name,
      email: signer.email,
      sequence: index + 1,
    })),
    {
      name: estimate.companySignerName ?? "Company representative",
      email: estimate.companySignerEmail ?? "",
      sequence: clientSigners.length + 1,
    },
  ]
  const foxit = await createFoxitPreparedEnvelope({
    clientId,
    clientSecret,
    folderName: `${estimate.estimateNumber} version ${estimate.versionNumber}`,
    pdfBase64: preparedPdf.pdfBase64,
    parties,
    fields: preparedPdf.fields,
    successUrl: returnUrl.toString(),
    errorUrl: failureUrl.toString(),
    estimateId,
    sourceHash,
  })
  const now = new Date().toISOString()
  await updateEstimates(access.db, eq(projectEstimates.id, estimateId), {
    title: reportTitle,
    foxitStatus: "preparing",
    foxitEnvelopeId: foxit.envelopeId,
    foxitEmbeddedSessionUrl: foxit.embeddedSessionUrl,
    foxitPreparedSourceHash: sourceHash,
    foxitPreparedAt: now,
    updatedAt: now,
  })
  return foxit.embeddedSessionUrl
}

/** Freezes the estimate for signatures collected outside Compass. */
export async function markEstimateSentOutsideCompass(
  access: EstimateAccess,
  estimate: EstimateRow
): Promise<void> {
  const estimateId = estimate.id
  const lines = await access.db
    .select()
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, estimateId))
    .orderBy(asc(projectEstimateLines.sortOrder))
  if (lines.length === 0) throw new Error("Add estimate lines before signature.")
  const unpriced = unpricedLinesMessage(lines)
  if (unpriced) throw new Error(unpriced)
  if (!cleanText(estimate.estimateDate)) {
    throw new Error("Add the estimate date before signature.")
  }
  if (projectEstimateClientSigners(estimate).length === 0) {
    throw new Error("Add at least one client or owner signer before signature.")
  }
  if (!cleanText(estimate.companySignerName)) {
    throw new Error("Add the company representative before signature.")
  }
  if (!cleanText(estimate.companySignerTitle)) {
    throw new Error("Add the company representative title before signature.")
  }
  if (!cleanText(estimate.contractTerms)) {
    throw new Error("Add the contract terms before signature.")
  }
  const fingerprint = JSON.stringify({
    estimate,
    signers: projectEstimateClientSigners(estimate),
    lines,
  })
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
  )
  const sourceHash = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
  const now = new Date().toISOString()
  await updateEstimates(access.db, eq(projectEstimates.id, estimateId), {
    status: "signature_pending",
    foxitStatus: "not_applicable",
    foxitEnvelopeId: null,
    foxitEmbeddedSessionUrl: null,
    signatureRequestedAt: now,
    sourceHash,
    updatedAt: now,
  })
}
