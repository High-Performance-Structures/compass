"use server"

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import {
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import {
  projectEstimateRfqBidImportLines,
  projectEstimateRfqBidImports,
  projectRfqBidApprovals,
} from "@/db/schema-rfqs"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  estimateCanBeEdited,
  isEstimateStatus,
} from "@/lib/financials/estimate-ledger"
import { requireOrg } from "@/lib/org-scope"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { can, requirePermission } from "@/lib/permissions"
import {
  approvedRfqResponseSnapshot,
  currencyAmountToCents,
  parseApprovedRfqResponseSnapshot,
  rfqResponseCoversScope,
} from "@/lib/rfqs/bid-workflow"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"
import { isInternalStaffRole } from "@/lib/user-roles"

type CompassDb = ReturnType<typeof getDb>

type RfqBidAccess = {
  readonly db: CompassDb
  readonly user: AuthUser
}

export type ProjectRfqBidWorkflowItem = {
  readonly rfqOperationId: string
  readonly approval: {
    readonly id: string
    readonly amountCents: number
    readonly approvalNote: string | null
    readonly approvedByName: string
    readonly approvedAt: string
  }
  readonly estimateImport: {
    readonly id: string
    readonly estimateId: string
    readonly estimateLabel: string
    readonly lineCount: number
    readonly importedAt: string
    readonly importedByName: string
  } | null
}

export type ProjectRfqBidWorkspace = {
  readonly canApprove: boolean
  readonly canImport: boolean
  readonly workflows: readonly ProjectRfqBidWorkflowItem[]
  readonly editableEstimates: readonly {
    readonly id: string
    readonly label: string
  }[]
}

type RfqBidActionResult =
  | { readonly success: true; readonly id: string; readonly lineCount?: number }
  | { readonly success: false; readonly error: string }

async function rfqBidAccess(
  projectId: string,
  action: "read" | "approve"
): Promise<RfqBidAccess> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "rfqs", action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")
  return { db, user }
}

function actorName(user: AuthUser): string {
  return user.displayName?.trim() || user.email
}

function estimateLabel(estimate: {
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
}): string {
  return `${estimate.estimateNumber} v${estimate.versionNumber} · ${estimate.title}`
}

export async function getProjectRfqBidWorkspace(
  projectId: string
): Promise<ProjectRfqBidWorkspace> {
  const access = await rfqBidAccess(projectId, "read")
  const canApprove = await canFeature(access.user, "rfqs", "approve")
  const canImport =
    canApprove &&
    isInternalStaffRole(access.user.role) &&
    can(access.user, "budget", "update")
  const [approvalRows, importRows, importLineRows, estimateRows] =
    await Promise.all([
      access.db
        .select()
        .from(projectRfqBidApprovals)
        .where(eq(projectRfqBidApprovals.projectId, projectId))
        .orderBy(asc(projectRfqBidApprovals.approvedAt)),
      access.db
        .select()
        .from(projectEstimateRfqBidImports)
        .where(eq(projectEstimateRfqBidImports.projectId, projectId)),
      access.db
        .select({
          importId: projectEstimateRfqBidImportLines.importId,
        })
        .from(projectEstimateRfqBidImportLines)
        .innerJoin(
          projectEstimateRfqBidImports,
          eq(
            projectEstimateRfqBidImportLines.importId,
            projectEstimateRfqBidImports.id
          )
        )
        .where(eq(projectEstimateRfqBidImports.projectId, projectId)),
      can(access.user, "budget", "read")
        ? access.db
            .select({
              id: projectEstimates.id,
              estimateNumber: projectEstimates.estimateNumber,
              versionNumber: projectEstimates.versionNumber,
              title: projectEstimates.title,
              status: projectEstimates.status,
            })
            .from(projectEstimates)
            .where(eq(projectEstimates.projectId, projectId))
            .orderBy(
              asc(projectEstimates.estimateNumber),
              asc(projectEstimates.versionNumber)
            )
        : Promise.resolve([]),
    ])
  const estimateMap = new Map(estimateRows.map((row) => [row.id, row]))

  return {
    canApprove,
    canImport,
    workflows: approvalRows.map((approval) => {
      const estimateImport = importRows.find(
        (item) => item.approvalId === approval.id
      )
      const estimate = estimateImport
        ? estimateMap.get(estimateImport.estimateId)
        : null
      return {
        rfqOperationId: approval.rfqOperationId,
        approval: {
          id: approval.id,
          amountCents: approval.amountCents,
          approvalNote: approval.approvalNote,
          approvedByName: approval.approvedByName,
          approvedAt: approval.approvedAt,
        },
        estimateImport: estimateImport
          ? {
              id: estimateImport.id,
              estimateId: estimateImport.estimateId,
              estimateLabel: estimate
                ? estimateLabel(estimate)
                : "Estimate no longer available",
              lineCount: importLineRows.filter(
                (line) => line.importId === estimateImport.id
              ).length,
              importedAt: estimateImport.importedAt,
              importedByName: estimateImport.importedByName,
            }
          : null,
      }
    }),
    editableEstimates: estimateRows
      .filter(
        (estimate) =>
          isEstimateStatus(estimate.status) &&
          estimateCanBeEdited(estimate.status)
      )
      .map((estimate) => ({ id: estimate.id, label: estimateLabel(estimate) })),
  }
}

export async function approveProjectRfqBid(
  projectId: string,
  rfqOperationId: string,
  approvalNote: string | null
): Promise<RfqBidActionResult> {
  try {
    const access = await rfqBidAccess(projectId, "approve")
    const rfq = await access.db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, rfqOperationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!rfq) return { success: false, error: "RFQ not found." }
    if (rfq.status !== "response_received") {
      return {
        success: false,
        error: "A submitted vendor quote is required before approval.",
      }
    }
    const payload = parsePortalRfqPayload(rfq.sagePayloadJson)
    const response = payload.vendorResponse
    if (
      !response ||
      response.decision !== "quote" ||
      response.amount === null
    ) {
      return { success: false, error: "This RFQ has no quote to approve." }
    }
    if (
      !rfqResponseCoversScope(
        payload.scopeItems.map((line) => line.lineNumber),
        response.lines
      )
    ) {
      return {
        success: false,
        error: "Enter a price for every RFQ scope line before approval.",
      }
    }
    const existing = await access.db
      .select({ id: projectRfqBidApprovals.id })
      .from(projectRfqBidApprovals)
      .where(eq(projectRfqBidApprovals.rfqOperationId, rfqOperationId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (existing) return { success: true, id: existing.id }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const note = approvalNote?.trim() || null
    const amountCents = currencyAmountToCents(response.amount)
    const responseSnapshotJson = approvedRfqResponseSnapshot(response)
    const approvalInsert = access.db.insert(projectRfqBidApprovals).select(
      sql`SELECT
        ${id}, ${projectId}, ${rfqOperationId}, ${amountCents},
        ${responseSnapshotJson}, ${response.responderName},
        ${response.responderCompany}, ${response.submittedAt}, ${note},
        ${access.user.id}, ${actorName(access.user)}, ${now}, ${now}
      FROM ${projectOperations}
      WHERE ${projectOperations.id} = ${rfqOperationId}
        AND ${projectOperations.projectId} = ${projectId}
        AND ${projectOperations.sourceRecordType} = 'rfq'
        AND ${projectOperations.status} = 'response_received'
        AND ${projectOperations.updatedAt} = ${rfq.updatedAt}
        AND NOT EXISTS (
          SELECT 1 FROM ${projectRfqBidApprovals}
          WHERE ${projectRfqBidApprovals.rfqOperationId} = ${rfqOperationId}
        )`
    )
    await access.db.batch([
      approvalInsert,
      access.db
        .update(projectOperations)
        .set({ status: "awarded", updatedAt: now })
        .where(
          and(
            eq(projectOperations.id, rfqOperationId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.status, "response_received"),
            eq(projectOperations.updatedAt, rfq.updatedAt),
            sql`EXISTS (
              SELECT 1 FROM ${projectRfqBidApprovals}
              WHERE ${projectRfqBidApprovals.id} = ${id}
            )`
          )
        ),
    ])
    const completedApproval = await access.db
      .select({
        id: projectRfqBidApprovals.id,
        status: projectOperations.status,
      })
      .from(projectRfqBidApprovals)
      .innerJoin(
        projectOperations,
        eq(projectOperations.id, projectRfqBidApprovals.rfqOperationId)
      )
      .where(eq(projectRfqBidApprovals.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!completedApproval || completedApproval.status !== "awarded") {
      return {
        success: false,
        error: "The RFQ response changed. Refresh and review the latest bid.",
      }
    }
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    revalidatePath("/dashboard")
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to approve bid.",
    }
  }
}

export async function importApprovedProjectRfqBid(
  projectId: string,
  approvalId: string,
  estimateId: string
): Promise<RfqBidActionResult> {
  try {
    const access = await rfqBidAccess(projectId, "approve")
    requirePermission(access.user, "budget", "update")
    if (!isInternalStaffRole(access.user.role)) {
      return { success: false, error: "Only internal staff can import bids." }
    }
    const [approvalRows, importRows, estimateRows, existingEstimateLines] =
      await Promise.all([
        access.db
          .select()
          .from(projectRfqBidApprovals)
          .where(
            and(
              eq(projectRfqBidApprovals.id, approvalId),
              eq(projectRfqBidApprovals.projectId, projectId)
            )
          )
          .limit(1),
        access.db
          .select({ id: projectEstimateRfqBidImports.id })
          .from(projectEstimateRfqBidImports)
          .where(eq(projectEstimateRfqBidImports.approvalId, approvalId))
          .limit(1),
        access.db
          .select()
          .from(projectEstimates)
          .where(
            and(
              eq(projectEstimates.id, estimateId),
              eq(projectEstimates.projectId, projectId)
            )
          )
          .limit(1),
        access.db
          .select()
          .from(projectEstimateLines)
          .where(eq(projectEstimateLines.estimateId, estimateId)),
      ])
    const approval = approvalRows[0]
    if (!approval) return { success: false, error: "Approved bid not found." }
    if (importRows[0]) {
      return { success: false, error: "This approved bid was already imported." }
    }
    const estimate = estimateRows[0]
    if (!estimate || !isEstimateStatus(estimate.status)) {
      return { success: false, error: "Estimate not found." }
    }
    if (!estimateCanBeEdited(estimate.status)) {
      return {
        success: false,
        error: "Choose a draft or internal-review estimate.",
      }
    }
    const rfq = await access.db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, approval.rfqOperationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!rfq) return { success: false, error: "Source RFQ not found." }
    const response = parseApprovedRfqResponseSnapshot(
      approval.responseSnapshotJson
    )
    if (!response) {
      return { success: false, error: "Approved bid snapshot is invalid." }
    }
    const rfqPayload = parsePortalRfqPayload(rfq.sagePayloadJson)
    if (
      !rfqResponseCoversScope(
        rfqPayload.scopeItems.map((line) => line.lineNumber),
        response.lines
      )
    ) {
      return {
        success: false,
        error: "The approved bid is missing prices for one or more RFQ scope lines.",
      }
    }
    const pricedLines =
      response.lines.length > 0
        ? response.lines
        : [
            {
              lineNumber: rfqPayload.scopeItems[0]?.lineNumber ?? 1,
              amountCents: approval.amountCents,
              notes: response.notes,
            },
          ]
    const priorSortOrder = existingEstimateLines.reduce(
      (highest, line) => Math.max(highest, line.sortOrder),
      0
    )
    const now = new Date().toISOString()
    const importId = crypto.randomUUID()
    const lineValues = pricedLines.map((pricedLine, index) => {
      const scope = rfqPayload.scopeItems.find(
        (line) => line.lineNumber === pricedLine.lineNumber
      )
      const amountCents = pricedLine.amountCents
      const costCode = scope?.costCode ?? rfq.costCode ?? "RFQ"
      const divisionCode =
        scope?.phaseCode ?? (costCode.slice(0, 2).trim() || "00")
      const description = scope?.description ?? rfq.title
      const estimateLineId = crypto.randomUUID()
      const sourceNote = `Approved RFQ ${rfq.sourceRecordNumber ?? rfq.title} · ${response.responderCompany ?? response.responderName}`
      return {
        estimateLine: {
          id: estimateLineId,
          projectId,
          estimateId,
          templateLineId: null,
          divisionCode,
          divisionName: `RFQ bid · ${divisionCode}`,
          costCode,
          costCodeName: description,
          description,
          specifications:
            [scope?.notes, pricedLine.notes, response.notes, sourceNote]
              .filter((value) => Boolean(value))
              .join("\n") || null,
          quantity: 1,
          unit: "LS",
          unitCostCents: amountCents,
          directCostCents: amountCents,
          markupRateBasisPoints: 0,
          markupCents: 0,
          taxable: false,
          taxEntityId: null,
          taxCode: null,
          taxName: null,
          taxRateBasisPoints: 0,
          taxCents: 0,
          lineTotalCents: amountCents,
          ownerVisible: false,
          includeInBuilderFee: false,
          sortOrder: priorSortOrder + index + 1,
          createdAt: now,
          updatedAt: now,
        },
        provenance: {
          id: crypto.randomUUID(),
          importId,
          estimateLineId,
          rfqLineNumber: pricedLine.lineNumber,
          descriptionSnapshot: description,
          costCodeSnapshot: scope?.costCode ?? null,
          amountCents,
          createdAt: now,
        },
      }
    })
    const importedAmountCents = lineValues.reduce(
      (total, line) => total + line.estimateLine.lineTotalCents,
      0
    )
    if (importedAmountCents !== approval.amountCents) {
      return {
        success: false,
        error: "Approved bid line prices no longer match the approved total.",
      }
    }
    const importInsert = access.db
      .insert(projectEstimateRfqBidImports)
      .select(
        sql`SELECT
          ${importId}, ${projectId}, ${approvalId}, ${estimateId},
          ${importedAmountCents}, ${access.user.id}, ${actorName(access.user)},
          ${now}, ${now}
        FROM ${projectEstimates}
        WHERE ${projectEstimates.id} = ${estimateId}
          AND ${projectEstimates.projectId} = ${projectId}
          AND ${projectEstimates.status} IN ('draft', 'internal_review')
          AND NOT EXISTS (
            SELECT 1 FROM ${projectEstimateRfqBidImports}
            WHERE ${projectEstimateRfqBidImports.approvalId} = ${approvalId}
          )`
      )
    const estimateLineInserts = lineValues.map((line) =>
      access.db.insert(projectEstimateLines).select(
        sql`SELECT
          ${line.estimateLine.id}, ${line.estimateLine.projectId},
          ${line.estimateLine.estimateId}, NULL,
          ${line.estimateLine.divisionCode}, ${line.estimateLine.divisionName},
          ${line.estimateLine.costCode}, ${line.estimateLine.costCodeName},
          ${line.estimateLine.description}, ${line.estimateLine.specifications},
          ${line.estimateLine.quantity}, ${line.estimateLine.unit},
          ${line.estimateLine.unitCostCents}, ${line.estimateLine.directCostCents},
          ${line.estimateLine.markupRateBasisPoints}, ${line.estimateLine.markupCents},
          0, NULL, NULL, NULL, ${line.estimateLine.taxRateBasisPoints},
          ${line.estimateLine.taxCents}, ${line.estimateLine.lineTotalCents},
          0, 0, ${line.estimateLine.sortOrder}, ${now}, ${now}
        WHERE EXISTS (
          SELECT 1 FROM ${projectEstimateRfqBidImports}
          WHERE ${projectEstimateRfqBidImports.id} = ${importId}
        )`
      )
    )
    const provenanceInserts = lineValues.map((line) =>
      access.db.insert(projectEstimateRfqBidImportLines).select(
        sql`SELECT
          ${line.provenance.id}, ${importId}, ${line.provenance.estimateLineId},
          ${line.provenance.rfqLineNumber},
          ${line.provenance.descriptionSnapshot},
          ${line.provenance.costCodeSnapshot}, ${line.provenance.amountCents},
          ${now}
        WHERE EXISTS (
          SELECT 1 FROM ${projectEstimateRfqBidImports}
          WHERE ${projectEstimateRfqBidImports.id} = ${importId}
        )`
      )
    )
    // These aggregates execute after the conditional line inserts in the same
    // D1 batch, so they include any estimate edits committed before the batch.
    const directCostTotal = sql<number>`COALESCE((
      SELECT SUM(${projectEstimateLines.directCostCents})
      FROM ${projectEstimateLines}
      WHERE ${projectEstimateLines.estimateId} = ${estimateId}
    ), 0)`
    const markupTotal = sql<number>`COALESCE((
      SELECT SUM(${projectEstimateLines.markupCents})
      FROM ${projectEstimateLines}
      WHERE ${projectEstimateLines.estimateId} = ${estimateId}
    ), 0)`
    const taxTotal = sql<number>`COALESCE((
      SELECT SUM(${projectEstimateLines.taxCents})
      FROM ${projectEstimateLines}
      WHERE ${projectEstimateLines.estimateId} = ${estimateId}
    ), 0)`
    const lineTotal = sql<number>`COALESCE((
      SELECT SUM(${projectEstimateLines.lineTotalCents})
      FROM ${projectEstimateLines}
      WHERE ${projectEstimateLines.estimateId} = ${estimateId}
    ), 0)`
    const builderFeeBase = sql<number>`COALESCE((
      SELECT SUM(CASE
        WHEN ${projectEstimateLines.includeInBuilderFee} = 1
          THEN ${projectEstimateLines.lineTotalCents}
        ELSE 0 END)
      FROM ${projectEstimateLines}
      WHERE ${projectEstimateLines.estimateId} = ${estimateId}
    ), 0)`
    const overheadTotal = sql<number>`ROUND(
      (${builderFeeBase} * ${projectEstimates.overheadRateBasisPoints}) / 10000.0
    )`
    const marginTotal = sql<number>`ROUND(
      (${builderFeeBase} * ${projectEstimates.marginRateBasisPoints}) / 10000.0
    )`
    const contingencyTotal = sql<number>`ROUND(
      (${builderFeeBase} * ${projectEstimates.contingencyRateBasisPoints}) / 10000.0
    )`
    await access.db.batch([
      importInsert,
      ...estimateLineInserts,
      ...provenanceInserts,
      access.db
        .update(projectEstimates)
        .set({
          directCostCents: directCostTotal,
          markupCents: markupTotal,
          taxCents: taxTotal,
          builderFeeBaseCents: builderFeeBase,
          overheadCents: overheadTotal,
          marginCents: marginTotal,
          contingencyCents: contingencyTotal,
          builderFeeCents: sql`${overheadTotal} + ${marginTotal} + ${contingencyTotal}`,
          estimateTotalCents: sql`${lineTotal} + ${overheadTotal} + ${marginTotal} + ${contingencyTotal}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectEstimates.id, estimateId),
            inArray(projectEstimates.status, ["draft", "internal_review"]),
            sql`EXISTS (
              SELECT 1 FROM ${projectEstimateRfqBidImports}
              WHERE ${projectEstimateRfqBidImports.id} = ${importId}
            )`
          )
        ),
    ])
    const completedImport = await access.db
      .select({ id: projectEstimateRfqBidImports.id })
      .from(projectEstimateRfqBidImports)
      .where(eq(projectEstimateRfqBidImports.id, importId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!completedImport) {
      return {
        success: false,
        error: "The estimate changed or became locked. Refresh and try again.",
      }
    }
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/estimate`)
    revalidatePath(`/dashboard/projects/${projectId}/estimate/compare`)
    revalidatePath(`/print/projects/${projectId}/estimate`)
    return { success: true, id: importId, lineCount: lineValues.length }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to import the approved bid.",
    }
  }
}
