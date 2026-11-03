import { and, eq, inArray } from "drizzle-orm"

import { projectOperations } from "@/db/schema"
import { projectEstimateLines } from "@/db/schema-estimates"
import { projectEstimateRfqBidImportLines, projectEstimateRfqBidImports, projectRfqBidApprovals } from "@/db/schema-rfqs"
import { estimateAccess, type EstimateAccess } from "@/lib/domain/estimates/access"
import { findPricingSource } from "@/lib/estimates/pricing-sources"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type SelectedTrade = {
  readonly rfqId: string
  readonly rfqNumber: string | null
  readonly vendor: string
  readonly ownerScope: boolean
  /** Sage cost types of the lines this bid filled ("subcontract", "material", ...). */
  readonly sageCostTypes: readonly string[]
  readonly recipientEmail: string | null
  readonly responderName: string
  readonly quoteSubmittedAt: string | null
  readonly codes: readonly { readonly costCode: string | null; readonly description: string; readonly amountCents: number }[]
  readonly totalCents: number
  readonly acceptedAt: string
  readonly acceptedByName: string
}


/** This job's RFQs with answers, their approvals, and what each put into this estimate. */
export async function loadRfqAnswers(access: EstimateAccess, projectId: string, estimateId: string) {
  const [rfqs, approvals, imports] = await Promise.all([
    access.db
      .select({
        id: projectOperations.id,
        number: projectOperations.sourceRecordNumber,
        title: projectOperations.title,
        status: projectOperations.status,
        companyName: projectOperations.companyName,
        payloadJson: projectOperations.sagePayloadJson,
      })
      .from(projectOperations)
      .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "rfq"))),
    access.db
      .select({ id: projectRfqBidApprovals.id, rfqOperationId: projectRfqBidApprovals.rfqOperationId })
      .from(projectRfqBidApprovals)
      .where(eq(projectRfqBidApprovals.projectId, projectId)),
    access.db
      .select({
        importId: projectEstimateRfqBidImports.id,
        approvalId: projectEstimateRfqBidImports.approvalId,
        importedAt: projectEstimateRfqBidImports.importedAt,
        importedByName: projectEstimateRfqBidImports.importedByName,
        lineNumber: projectEstimateRfqBidImportLines.rfqLineNumber,
        estimateLineId: projectEstimateRfqBidImportLines.estimateLineId,
        costCode: projectEstimateRfqBidImportLines.costCodeSnapshot,
        description: projectEstimateRfqBidImportLines.descriptionSnapshot,
        amountCents: projectEstimateRfqBidImportLines.amountCents,
      })
      .from(projectEstimateRfqBidImports)
      .innerJoin(projectEstimateRfqBidImportLines, eq(projectEstimateRfqBidImportLines.importId, projectEstimateRfqBidImports.id))
      .where(and(eq(projectEstimateRfqBidImports.projectId, projectId), eq(projectEstimateRfqBidImports.estimateId, estimateId))),
  ])
  const approvalByRfq = new Map(approvals.map((approval) => [approval.rfqOperationId, approval.id]))
  const rfqByApproval = new Map(approvals.map((approval) => [approval.id, approval.rfqOperationId]))
  return { rfqs, approvalByRfq, rfqByApproval, imports }
}

/** Who has been selected for this estimate, from the bids accepted into it. */
export async function loadEstimateSelectedTrades(projectId: string, estimateId: string): Promise<Result<readonly SelectedTrade[]>> {
  try {
    const access = await estimateAccess(projectId, false)
    if (!isInternalStaffRole(access.user.role)) return { success: false, error: "Selected trades are for office staff." }
    if (!access.organizationId) return { success: false, error: "The project organization is required." }
    const { rfqs, rfqByApproval, imports } = await loadRfqAnswers(access, projectId, estimateId)
    if (imports.length === 0) return { success: true, data: [] }
    const [approvals, lines, settings] = await Promise.all([
      access.db
        .select({
          id: projectRfqBidApprovals.id,
          responderCompany: projectRfqBidApprovals.responderCompany,
          responderName: projectRfqBidApprovals.responderName,
          responseSubmittedAt: projectRfqBidApprovals.responseSubmittedAt,
        })
        .from(projectRfqBidApprovals)
        .where(inArray(projectRfqBidApprovals.id, [...new Set(imports.map((row) => row.approvalId))])),
      access.db
        .select({ id: projectEstimateLines.id, pricingSource: projectEstimateLines.pricingSource })
        .from(projectEstimateLines)
        .where(eq(projectEstimateLines.estimateId, estimateId)),
      readFeatureSettings(access.db, access.organizationId, "estimate-pricing"),
    ])
    const sourceByLine = new Map(lines.map((line) => [line.id, line.pricingSource]))
    const trades = approvals.map((approval): SelectedTrade => {
      const rows = imports.filter((row) => row.approvalId === approval.id)
      const rfqId = rfqByApproval.get(approval.id) ?? ""
      const rfq = rfqs.find((item) => item.id === rfqId)
      const sources = rows.map((row) => findPricingSource(settings.sources, row.estimateLineId ? sourceByLine.get(row.estimateLineId) : null))
      return {
        rfqId,
        rfqNumber: rfq?.number ?? null,
        vendor: approval.responderCompany?.trim() || rfq?.companyName?.trim() || approval.responderName,
        ownerScope: sources.some((source) => source?.ownerScope === true),
        sageCostTypes: [...new Set(sources.flatMap((source) => (source ? [source.sageCostType] : [])))],
        recipientEmail: rfq ? parsePortalRfqPayload(rfq.payloadJson).recipientEmail : null,
        responderName: approval.responderName,
        quoteSubmittedAt: approval.responseSubmittedAt || null,
        codes: rows.map((row) => ({ costCode: row.costCode, description: row.description, amountCents: row.amountCents })),
        totalCents: rows.reduce((total, row) => total + row.amountCents, 0),
        acceptedAt: rows[0]?.importedAt ?? "",
        acceptedByName: rows[0]?.importedByName ?? "",
      }
    })
    return { success: true, data: trades.sort((a, b) => Number(a.ownerScope) - Number(b.ownerScope) || a.vendor.localeCompare(b.vendor)) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not load the selected trades." }
  }
}
