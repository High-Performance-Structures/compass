import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectContractBudgetRevisions,
  projectEstimateAssemblies,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import {
  clientEstimateReportGroups,
  isEstimateClientReportMode,
  type ClientEstimatePhase,
  type EstimateClientReportMode,
} from "@/lib/estimates/client-report"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { PayApplicationOwnerDetail } from "@/lib/financials/pay-application-detail"

type Db = ReturnType<typeof getDb>

/** The accepted contract estimate the owner signed, as the owner budget needs it. */
export type OwnerContractEstimate = {
  readonly id: string
  readonly reportMode: EstimateClientReportMode
  readonly showCostBreakdowns: boolean
}

/**
 * The owner budget shows what the signed estimate showed: assembly reports
 * become assembly rows, line-item reports cost codes, division and phase
 * reports divisions.
 */
export function ownerDetailForEstimateMode(
  mode: EstimateClientReportMode
): PayApplicationOwnerDetail {
  if (mode === "assembly_summary" || mode === "assembly_items") return "assembly"
  if (mode === "line_items") return "cost_code"
  return "division"
}

/**
 * The budget revision's accepted estimate, else the job's latest accepted
 * contract estimate (imported pay applications have no revision).
 */
export async function loadOwnerContractEstimate(
  db: Db,
  projectId: string,
  budgetRevisionId: string | null
): Promise<OwnerContractEstimate | null> {
  const columns = {
    id: projectEstimates.id,
    clientReportMode: projectEstimates.clientReportMode,
    showCostBreakdowns: projectEstimates.showCostBreakdowns,
  }
  const fromRevision = budgetRevisionId
    ? await db
        .select(columns)
        .from(projectContractBudgetRevisions)
        .innerJoin(projectEstimates, eq(projectEstimates.id, projectContractBudgetRevisions.acceptedEstimateId))
        .where(eq(projectContractBudgetRevisions.id, budgetRevisionId))
        .get()
    : undefined
  const row =
    fromRevision ??
    (await db
      .select(columns)
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, projectId),
          eq(projectEstimates.status, "accepted"),
          isNull(projectEstimates.changeOrderId),
          isNull(projectEstimates.phaseProposalId)
        )
      )
      .orderBy(desc(projectEstimates.versionNumber), desc(projectEstimates.updatedAt))
      .get())
  if (!row || !isEstimateClientReportMode(row.clientReportMode)) return null
  return { id: row.id, reportMode: row.clientReportMode, showCostBreakdowns: row.showCostBreakdowns }
}

/** Where a pay application's client detail comes from when the draw sets none. */
export type DefaultOwnerDetail = {
  readonly detail: PayApplicationOwnerDetail
  readonly source: "estimate" | "company"
}

/** A draw without its own client detail follows the signed estimate, else the company default. */
export async function defaultOwnerDetail(
  db: Db,
  organizationId: string | null,
  estimate: OwnerContractEstimate | null
): Promise<DefaultOwnerDetail> {
  if (estimate) return { detail: ownerDetailForEstimateMode(estimate.reportMode), source: "estimate" }
  const detail = organizationId
    ? (await readFeatureSettings(db, organizationId, "pay-applications")).ownerDetail
    : FEATURE_SETTINGS["pay-applications"].defaults.ownerDetail
  return { detail, source: "company" }
}

/**
 * The assemblies the estimate itemized for the client (an "assembly items"
 * report, or assemblies marked for client detail), with only the fields the
 * printed estimate shows.
 */
export async function loadOwnerItemizedAssemblies(
  db: Db,
  estimate: OwnerContractEstimate
): Promise<readonly ClientEstimatePhase[]> {
  const [assemblies, lines] = await Promise.all([
    db
      .select()
      .from(projectEstimateAssemblies)
      .where(eq(projectEstimateAssemblies.estimateId, estimate.id))
      .orderBy(asc(projectEstimateAssemblies.sortOrder)),
    db
      .select()
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.estimateId, estimate.id), eq(projectEstimateLines.ownerVisible, true))),
  ])
  if (estimate.reportMode !== "assembly_items" && !assemblies.some((assembly) => assembly.clientDetail)) return []
  const costItems = lines.length
    ? await db
        .select()
        .from(projectEstimateLineCostItems)
        .where(inArray(projectEstimateLineCostItems.estimateLineId, lines.map((line) => line.id)))
        .orderBy(asc(projectEstimateLineCostItems.sortOrder))
    : []
  const groups = clientEstimateReportGroups({
    mode: estimate.reportMode,
    assemblies: assemblies.map(({ id, name, description, sortOrder, clientDetail }) => ({ id, name, description, sortOrder, clientDetail })),
    lines: lines.map((line) => ({
      id: line.id,
      assemblyId: line.assemblyId,
      reportPhaseId: line.reportPhaseId,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: line.specifications,
      quantity: line.quantity,
      unit: line.unit,
      unitCostCents: line.unitCostCents,
      taxCode: line.taxCode,
      taxName: line.taxName,
      taxRateBasisPoints: line.taxRateBasisPoints,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
      ownerVisible: line.ownerVisible,
      includeInBuilderFee: line.includeInBuilderFee,
      sortOrder: line.sortOrder,
      // Cost breakdowns print only when the estimate or the assembly shows them.
      costItems: costItems
        .filter((item) => item.estimateLineId === line.id)
        .map((item) => ({
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
        })),
    })),
    phaseDescriptions: {},
  })
  return groups
    .filter((group) => group.itemize)
    .map((group) =>
      estimate.showCostBreakdowns || group.costBreakdowns
        ? group
        : { ...group, lines: group.lines.map((line) => ({ ...line, costItems: [] })) }
    )
}
