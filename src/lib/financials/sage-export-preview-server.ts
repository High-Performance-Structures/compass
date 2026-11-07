import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines, projectChangeOrders, projects } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { COMPASS_DRAW_SOURCE, SAGE_SNAPSHOT_SOURCE } from "@/lib/domain/financials/rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { linesWithVariances } from "@/lib/financials/pay-application-change-orders"
import { indexSageCatalog } from "@/lib/financials/sage-export-codes"
import {
  applicationSequence,
  payRequestDescription,
  sageChangeOrderPreviews,
  sageExportLines,
  sagePeriod,
  type SageChangeOrderPreview,
  type SageChangeOrderSource,
  type SageExportLine,
} from "@/lib/financials/sage-export-preview"
import { formatSageInvoiceNumber, type SageInvoiceNumber } from "@/lib/financials/sage-invoice-number"
import { reconcileWithSage, type SageReconciliation } from "@/lib/financials/sage-export-reconcile"
import type { Db } from "@/lib/server/action-context"

/*
 * Loads the Sage export preview for one owner pay application. Read only: it
 * reads Compass rows and the Sage data Compass already holds, and never
 * writes to Sage or queues a Sage write.
 */

export type SageExportPreview = {
  readonly project: { readonly name: string; readonly projectNumber: string | null }
  readonly header: {
    readonly sageJobNumber: string | null
    readonly applicationId: string
    readonly applicationNumber: string
    readonly applicationSequence: string
    readonly status: string
    readonly periodTo: string | null
    readonly sagePeriod: number | null
    readonly billingCycle: string
    readonly description: string | null
    readonly invoiceNumber: SageInvoiceNumber
    /** Entered by staff once Sage invoiced the draw; null until then. */
    readonly recordedSageInvoiceNumber: string | null
  }
  readonly lines: readonly (SageExportLine & {
    /** Needs "Append as new line" in Sage; null when Compass has no Sage billing to compare. */
    readonly newToSage: boolean | null
  })[]
  readonly reconciliation: SageReconciliation
  /** Sage's latest billing is already this application or a later one, so "previous" figures won't line up. */
  readonly sageAlreadyHasThisApplication: boolean
  readonly changeOrders: readonly SageChangeOrderPreview[]
  readonly unmappedCount: number
}

async function loadSageBilling(db: Db, projectId: string) {
  const application = await db
    .select()
    .from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.projectId, projectId), eq(projectBudgetApplications.sourceSystem, SAGE_SNAPSHOT_SOURCE)))
    .orderBy(desc(projectBudgetApplications.periodTo), desc(projectBudgetApplications.lastSyncedAt), desc(projectBudgetApplications.createdAt))
    .limit(1)
    .get()
  if (!application) return null
  const lines = await db
    .select({
      costCode: projectBudgetLines.costCode,
      description: projectBudgetLines.description,
      adjustedEstimate: projectBudgetLines.adjustedEstimate,
      totalCompletedStored: projectBudgetLines.totalCosts,
    })
    .from(projectBudgetLines)
    .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, application.id)))
    .orderBy(asc(projectBudgetLines.sortOrder))
  return {
    header: {
      applicationNumber: application.applicationNumber,
      periodTo: application.periodTo,
      capturedAt: application.lastSyncedAt,
      contractSumToDate: application.contractSumToDate,
      totalCompletedStoredToDate: application.totalCompletedStoredToDate,
    },
    lines,
  }
}

/** Executed change orders and variances in the draw's contract budget, by cost code. */
async function loadChangeOrders(db: Db, projectId: string, budgetRevisionId: string | null): Promise<readonly SageChangeOrderSource[]> {
  if (!budgetRevisionId) return []
  const rows = await db
    .select({
      changeOrderId: projectContractBudgetAdjustments.changeOrderId,
      costCode: projectContractBudgetAdjustments.costCode,
      amountCents: projectContractBudgetAdjustments.amountCents,
      adjustmentExecutedAt: projectContractBudgetAdjustments.executedAt,
      number: projectChangeOrders.changeOrderNumber,
      title: projectChangeOrders.title,
      recordType: projectChangeOrders.recordType,
      executedAt: projectChangeOrders.executedAt,
      sageRecordId: projectChangeOrders.sageRecordId,
    })
    .from(projectContractBudgetAdjustments)
    .leftJoin(projectChangeOrders, eq(projectChangeOrders.id, projectContractBudgetAdjustments.changeOrderId))
    .where(and(eq(projectContractBudgetAdjustments.projectId, projectId), eq(projectContractBudgetAdjustments.revisionId, budgetRevisionId)))
  const byId = new Map<string, { source: Omit<SageChangeOrderSource, "lines">; lines: { costCode: string; amountCents: number }[] }>()
  for (const row of rows) {
    const entry = byId.get(row.changeOrderId) ?? {
      source: {
        id: row.changeOrderId,
        recordType: row.recordType === "variance" ? "variance" : "change_order",
        number: row.number ?? "",
        title: row.title ?? "",
        executedAt: row.executedAt ?? row.adjustmentExecutedAt,
        sageRecordId: row.sageRecordId,
      },
      lines: [],
    }
    entry.lines.push({ costCode: row.costCode, amountCents: row.amountCents })
    byId.set(row.changeOrderId, entry)
  }
  return [...byId.values()].map((entry) => ({ ...entry.source, lines: entry.lines }))
}

export async function loadSageExportPreview(
  db: Db,
  input: { readonly organizationId: string; readonly projectId: string; readonly applicationId: string }
): Promise<SageExportPreview | null> {
  const [project, application] = await Promise.all([
    db
      .select({ name: projects.name, projectNumber: projects.projectNumber, sageJobId: projects.sageJobId, sageJobNumber: projects.sageJobNumber })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)))
      .get(),
    db
      .select()
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, input.applicationId),
          eq(projectBudgetApplications.projectId, input.projectId),
          eq(projectBudgetApplications.sourceSystem, COMPASS_DRAW_SOURCE)
        )
      )
      .get(),
  ])
  if (!project || !application) return null
  const [lineRows, catalog, settings, sageBilling, changeOrderSources] = await Promise.all([
    db
      .select()
      .from(projectBudgetLines)
      .where(and(eq(projectBudgetLines.projectId, input.projectId), eq(projectBudgetLines.applicationId, application.id)))
      .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder)),
    loadProjectCostCodeCatalog(db),
    readFeatureSettings(db, input.organizationId, "sage-export"),
    loadSageBilling(db, input.projectId),
    loadChangeOrders(db, input.projectId, application.budgetRevisionId),
  ])
  const index = indexSageCatalog(catalog)
  const withVariances = await linesWithVariances(
    db,
    application.budgetRevisionId,
    lineRows.map((line) => ({
      costCode: line.costCode,
      assemblyKey: line.assemblyKey,
      divisionCode: line.csiDivision,
      description: line.description,
      originalEstimate: line.originalEstimate,
      totalChanges: line.totalChanges,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      totalCompletedStored: line.totalCosts,
      retainageHeld: line.retainageHeld,
      balanceToFinish: line.balanceToFinish,
    }))
  )
  const lines = sageExportLines(withVariances, index)
  const sageJobNumber = project.sageJobNumber ?? project.sageJobId
  const reconciliation = reconcileWithSage({
    lines,
    compassContractToDateCents: lines.reduce((sum, line) => sum + line.contractCents, 0),
    sage: sageBilling,
    index,
    unavailableReason: sageJobNumber
      ? "Compass hasn't read a progress billing from Sage for this job yet. Use Sync from Sage on the project's Budget page, then reopen this preview."
      : "This project isn't linked to a Sage job, so there is no Sage progress billing to compare.",
  })
  const sequence = applicationSequence(application.applicationNumber)
  const sageSequence = sageBilling ? Number(applicationSequence(sageBilling.header.applicationNumber)) : Number.NaN
  const newToSage = reconciliation.available ? new Set(reconciliation.newToSage) : null
  return {
    project: { name: project.name, projectNumber: project.projectNumber },
    header: {
      sageJobNumber,
      applicationId: application.id,
      applicationNumber: application.applicationNumber,
      applicationSequence: sequence,
      status: application.status,
      periodTo: application.periodTo,
      sagePeriod: sagePeriod(application.periodTo)?.period ?? null,
      billingCycle: settings.billingCycle,
      description: payRequestDescription(application.periodTo),
      invoiceNumber: formatSageInvoiceNumber(settings.payRequestInvoiceFormat, {
        projectNumber: project.projectNumber,
        sageJobNumber,
        number: sequence,
      }),
      recordedSageInvoiceNumber: application.sageInvoiceNumber,
    },
    lines: lines.map((line) => ({ ...line, newToSage: newToSage ? newToSage.has(line.key) : null })),
    reconciliation,
    sageAlreadyHasThisApplication: Number.isFinite(sageSequence) && Number(sequence) <= sageSequence,
    changeOrders: sageChangeOrderPreviews(changeOrderSources, index),
    unmappedCount: lines.filter((line) => line.mapping.status === "unmapped").length,
  }
}
