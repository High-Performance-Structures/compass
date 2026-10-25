"use server"

import { requireProjectAudienceReadUser } from "@/lib/project-audience-request-server"

import { and, asc, desc, eq, ne, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
} from "@/db/schema"
import { getCloudflareContext } from "@/lib/db"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  isPayApplicationOwnerDetail,
  type PayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"
import {
  UNASSIGNED_ASSEMBLY_NAME,
  loadPayApplicationShares,
} from "@/lib/financials/pay-application-shares"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  effectiveProjectBudgetAudience,
  type ProjectBudgetAudience,
} from "@/lib/project-budget-audience"
import {
  budgetApplicationStatus,
  budgetReconciliationSummary,
  sanitizeBudgetApplicationForOwner,
  sanitizeBudgetLineForOwner,
  scopeBudgetLinesToApplication,
  selectBudgetApplication,
  type BudgetLineSnapshotRow,
} from "@/lib/project-budget-snapshot"

export type { ProjectBudgetAudience } from "@/lib/project-budget-audience"
/** "category_percent" shows divisions by percent complete with no amounts. */
export type ProjectBudgetDetailMode =
  | "cost_code"
  | "category"
  | "category_percent"
  | "assembly"
  | "assembly_percent"

export type ProjectBudgetApplicationItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly applicationNumber: string
  readonly periodTo: string | null
  readonly status: string
  readonly originalContractSum: number
  readonly netChanges: number
  readonly contractSumToDate: number
  readonly totalCompletedStoredToDate: number
  readonly retainageHeld: number
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
  readonly currentPaymentDue: number
  readonly balanceToFinish: number
  readonly ownerVisible: boolean
  readonly documentAvailable: boolean
  readonly sourceUrl: string | null
  readonly lastSyncedAt: string | null
}

export type ProjectBudgetLineItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly costCode: string
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly description: string
  readonly notes: string | null
  readonly originalEstimate: number
  readonly priorChanges: number
  readonly currentChanges: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly percentComplete: number
  readonly balanceToFinish: number
  readonly retainageHeld: number
  readonly vendorName: string | null
  readonly ownerLabel: string | null
  readonly ownerVisible: boolean
  readonly internalNotes: string | null
}

export type ProjectBudgetDivision = {
  readonly csiDivision: string
  readonly csiDivisionName: string
  readonly originalEstimate: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly totalCosts: number
  readonly currentCosts: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
  readonly percentComplete: number
  readonly lineCount: number
  readonly lines: readonly ProjectBudgetLineItem[]
}

export type ProjectBudgetTotals = {
  readonly originalEstimate: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly priorCosts: number
  readonly totalCosts: number
  readonly currentCosts: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
  readonly percentComplete: number
  readonly overBudgetAmount: number
  readonly ownerVisibleLineCount: number
}

export type ProjectBudgetSummary = {
  readonly audience: ProjectBudgetAudience
  readonly detailMode: ProjectBudgetDetailMode
  readonly applications: readonly ProjectBudgetApplicationItem[]
  readonly currentApplication: ProjectBudgetApplicationItem | null
  readonly reconciliation: ReturnType<typeof budgetReconciliationSummary>
  readonly totals: ProjectBudgetTotals
  readonly divisions: readonly ProjectBudgetDivision[]
  readonly allLines: readonly ProjectBudgetLineItem[]
}

type ProjectAccess = {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string | null
  readonly viewerRole: string
}

async function verifyProjectAccess(projectId: string): Promise<ProjectAccess> {
  const user = await requireProjectAudienceReadUser(projectId)
  requirePermission(user, "budget", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)

  return {
    db,
    organizationId: project.organizationId,
    viewerRole: user.role,
  }
}

function toApplicationItem(
  row: typeof projectBudgetApplications.$inferSelect,
  audience: ProjectBudgetAudience
): ProjectBudgetApplicationItem {
  const documentAvailable =
    row.sourceSystem === "google_drive_g702_g703" &&
    Boolean(row.sourceRecordId)
  const application = {
    id: row.id,
    sourceSystem: row.sourceSystem,
    applicationNumber: row.applicationNumber,
    periodTo: row.periodTo,
    status: budgetApplicationStatus(row),
    originalContractSum: row.originalContractSum,
    netChanges: row.netChanges,
    contractSumToDate: row.contractSumToDate,
    totalCompletedStoredToDate: row.totalCompletedStoredToDate,
    retainageHeld: row.retainageHeld,
    totalEarnedLessRetainage: row.totalEarnedLessRetainage,
    previousCertificates: row.previousCertificates,
    currentPaymentDue: row.currentPaymentDue,
    balanceToFinish: row.balanceToFinish,
    ownerVisible: row.ownerVisible,
    documentAvailable,
    sourceUrl: row.sourceUrl,
    lastSyncedAt: row.lastSyncedAt,
  }
  return audience === "owner"
    ? sanitizeBudgetApplicationForOwner(application)
    : application
}

function toLineItem(
  row: typeof projectBudgetLines.$inferSelect,
  audience: ProjectBudgetAudience
): ProjectBudgetLineItem {
  const line = {
    id: row.id,
    sourceSystem: row.sourceSystem,
    costCode: row.costCode,
    csiDivision: row.csiDivision,
    csiDivisionName: row.csiDivisionName,
    description: row.description,
    notes: row.notes,
    originalEstimate: row.originalEstimate,
    priorChanges: row.priorChanges,
    currentChanges: row.currentChanges,
    totalChanges: row.totalChanges,
    adjustedEstimate: row.adjustedEstimate,
    priorCosts: row.priorCosts,
    currentCosts: row.currentCosts,
    totalCosts: row.totalCosts,
    percentComplete: row.percentComplete,
    balanceToFinish: row.balanceToFinish,
    retainageHeld: row.retainageHeld,
    vendorName: row.vendorName,
    ownerLabel: row.ownerLabel,
    ownerVisible: row.ownerVisible,
    internalNotes: row.internalNotes,
  }
  return audience === "owner" ? sanitizeBudgetLineForOwner(line) : line
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

const OWNER_DETAIL_MODES: Readonly<Record<PayApplicationOwnerDetail, ProjectBudgetDetailMode>> = {
  division_percent: "category_percent",
  assembly_percent: "assembly_percent",
  assembly: "assembly",
  division: "category",
  cost_code: "cost_code",
}

/** The draw's own client detail, else the company's pay application default. */
async function ownerDetailMode(
  access: ProjectAccess,
  applicationId: string | null
): Promise<ProjectBudgetDetailMode> {
  if (applicationId) {
    const row = await access.db
      .select({ ownerDetail: projectBudgetApplications.ownerDetail })
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.id, applicationId))
      .get()
    if (isPayApplicationOwnerDetail(row?.ownerDetail)) {
      return OWNER_DETAIL_MODES[row.ownerDetail]
    }
  }
  const fallback = FEATURE_SETTINGS["pay-applications"].defaults.ownerDetail
  if (!access.organizationId) return OWNER_DETAIL_MODES[fallback]
  const settings = await readFeatureSettings(access.db, access.organizationId, "pay-applications")
  return OWNER_DETAIL_MODES[settings.ownerDetail]
}

/** Percent-only client view: keep names and percent complete, drop every amount. */
function withoutAmounts<T extends ProjectBudgetLineItem | ProjectBudgetDivision>(row: T): T {
  return {
    ...row,
    originalEstimate: 0,
    priorChanges: 0,
    currentChanges: 0,
    totalChanges: 0,
    adjustedEstimate: 0,
    priorCosts: 0,
    currentCosts: 0,
    totalCosts: 0,
    balanceToFinish: 0,
    retainageHeld: 0,
  }
}

function buildDivisions(
  lines: readonly ProjectBudgetLineItem[]
): readonly ProjectBudgetDivision[] {
  const divisions = new Map<string, ProjectBudgetLineItem[]>()

  for (const line of lines) {
    const key = `${line.csiDivision}|${line.csiDivisionName}`
    const existing = divisions.get(key) ?? []
    existing.push(line)
    divisions.set(key, existing)
  }

  return Array.from(divisions.entries()).map(([key, items]) => {
    const [csiDivision, csiDivisionName] = key.split("|")
    const originalEstimate = items.reduce(
      (sum, item) => sum + item.originalEstimate,
      0
    )
    const totalChanges = items.reduce(
      (sum, item) => sum + item.totalChanges,
      0
    )
    const adjustedEstimate = items.reduce(
      (sum, item) => sum + item.adjustedEstimate,
      0
    )
    const totalCosts = items.reduce((sum, item) => sum + item.totalCosts, 0)
    const priorCosts = items.reduce((sum, item) => sum + item.priorCosts, 0)
    const currentCosts = items.reduce((sum, item) => sum + item.currentCosts, 0)
    const retainageHeld = items.reduce(
      (sum, item) => sum + item.retainageHeld,
      0
    )
    const balanceToFinish = items.reduce(
      (sum, item) => sum + item.balanceToFinish,
      0
    )

    return {
      csiDivision,
      csiDivisionName,
      originalEstimate,
      totalChanges,
      adjustedEstimate,
      priorCosts,
      totalCosts,
      currentCosts,
      retainageHeld,
      balanceToFinish,
      percentComplete: percent(totalCosts, adjustedEstimate),
      lineCount: items.length,
      lines: items,
    }
  })
}

function buildOwnerCategoryLines(
  lines: readonly ProjectBudgetLineItem[]
): readonly ProjectBudgetLineItem[] {
  const divisions = buildDivisions(lines)

  return divisions.map((division, index) => {
    const firstLine = division.lines[0]
    const priorChanges = division.lines.reduce(
      (sum, line) => sum + line.priorChanges,
      0
    )
    const currentChanges = division.lines.reduce(
      (sum, line) => sum + line.currentChanges,
      0
    )
    const priorCosts = division.lines.reduce(
      (sum, line) => sum + line.priorCosts,
      0
    )
    const retainageHeld = division.lines.reduce(
      (sum, line) => sum + line.retainageHeld,
      0
    )

    return {
      id: `owner-budget-category-${division.csiDivision}-${index}`,
      sourceSystem: firstLine?.sourceSystem ?? "compass",
      costCode: `${division.csiDivision} 00 00`,
      csiDivision: division.csiDivision,
      csiDivisionName: division.csiDivisionName,
      description: division.csiDivisionName,
      notes: "Owner category rollup.",
      originalEstimate: division.originalEstimate,
      priorChanges,
      currentChanges,
      totalChanges: division.totalChanges,
      adjustedEstimate: division.adjustedEstimate,
      priorCosts,
      currentCosts: division.currentCosts,
      totalCosts: division.totalCosts,
      percentComplete: division.percentComplete,
      balanceToFinish: division.balanceToFinish,
      retainageHeld,
      vendorName: null,
      ownerLabel: division.csiDivisionName,
      ownerVisible: true,
      internalNotes: null,
    }
  })
}

/** Pay application rows split by assembly, combined back to one per cost code. */
function combineByCostCode(lines: readonly ProjectBudgetLineItem[]): readonly ProjectBudgetLineItem[] {
  const byCode = new Map<string, ProjectBudgetLineItem>()
  for (const line of lines) {
    const current = byCode.get(line.costCode)
    if (!current) {
      byCode.set(line.costCode, { ...line, ownerLabel: line.description })
      continue
    }
    const totalCosts = current.totalCosts + line.totalCosts
    const adjustedEstimate = current.adjustedEstimate + line.adjustedEstimate
    byCode.set(line.costCode, {
      ...current,
      originalEstimate: current.originalEstimate + line.originalEstimate,
      priorChanges: current.priorChanges + line.priorChanges,
      currentChanges: current.currentChanges + line.currentChanges,
      totalChanges: current.totalChanges + line.totalChanges,
      adjustedEstimate,
      priorCosts: current.priorCosts + line.priorCosts,
      currentCosts: current.currentCosts + line.currentCosts,
      totalCosts,
      percentComplete: percent(totalCosts, adjustedEstimate),
      balanceToFinish: current.balanceToFinish + line.balanceToFinish,
      retainageHeld: current.retainageHeld + line.retainageHeld,
      ownerVisible: current.ownerVisible || line.ownerVisible,
    })
  }
  return [...byCode.values()]
}

type LineAssembly = { readonly key: string; readonly name: string; readonly sort: number }

async function assemblyByLine(
  access: ProjectAccess,
  applicationId: string
): Promise<ReadonlyMap<string, LineAssembly>> {
  const rows = await access.db
    .select({
      id: projectBudgetLines.id,
      assemblyKey: projectBudgetLines.assemblyKey,
      assemblyName: projectBudgetLines.assemblyName,
      assemblySort: projectBudgetLines.assemblySort,
    })
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.applicationId, applicationId))
  return new Map(
    rows.map((row) => [
      row.id,
      {
        key: row.assemblyKey ?? "",
        name: row.assemblyName ?? UNASSIGNED_ASSEMBLY_NAME,
        sort: row.assemblyKey ? row.assemblySort : 1_000_000,
      },
    ])
  )
}

/**
 * Assembly rows for the owner view. Pay application rows carry their
 * assembly; the contract budget projection (one row per cost code, no
 * progress yet) is split using the revision's assembly shares.
 */
async function assemblyLines(
  access: ProjectAccess,
  applicationId: string,
  lines: readonly ProjectBudgetLineItem[]
): Promise<readonly ProjectBudgetLineItem[]> {
  const assemblies = await assemblyByLine(access, applicationId)
  if ([...assemblies.values()].some((assembly) => assembly.key !== "")) {
    return buildAssemblyLines(lines, assemblies)
  }
  const application = await access.db
    .select({ budgetRevisionId: projectBudgetApplications.budgetRevisionId })
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.id, applicationId))
    .get()
  if (!application?.budgetRevisionId) return buildAssemblyLines(lines, assemblies)
  const visibleCostCodes = new Set(lines.map((line) => line.costCode))
  const shares = (await loadPayApplicationShares(access.db, application.budgetRevisionId)).filter((share) =>
    visibleCostCodes.has(share.costCode)
  )
  const shareLines: ProjectBudgetLineItem[] = shares.map((share, index) => ({
    id: `budget-share-${index}`,
    sourceSystem: "compass_contract_budget_projection",
    costCode: share.costCode,
    csiDivision: share.divisionCode,
    csiDivisionName: share.divisionName,
    description: share.description,
    notes: null,
    originalEstimate: share.originalEstimateCents / 100,
    priorChanges: share.approvedChangeCents / 100,
    currentChanges: 0,
    totalChanges: share.approvedChangeCents / 100,
    adjustedEstimate: share.adjustedBudgetCents / 100,
    priorCosts: 0,
    currentCosts: 0,
    totalCosts: 0,
    percentComplete: 0,
    balanceToFinish: share.adjustedBudgetCents / 100,
    retainageHeld: 0,
    vendorName: null,
    ownerLabel: share.description,
    ownerVisible: share.ownerVisible,
    internalNotes: null,
  }))
  const shareAssemblies = new Map(
    shares.map((share, index) => [
      `budget-share-${index}`,
      {
        key: share.assemblyKey ?? "",
        name: share.assemblyName ?? UNASSIGNED_ASSEMBLY_NAME,
        sort: share.assemblyKey ? share.assemblySort : 1_000_000,
      },
    ])
  )
  return buildAssemblyLines(shareLines, shareAssemblies)
}

/**
 * One row per assembly (or change order). Each becomes its own group in the
 * owner view: the division fields carry the assembly's position and name.
 */
function buildAssemblyLines(
  lines: readonly ProjectBudgetLineItem[],
  assemblies: ReadonlyMap<string, LineAssembly>
): readonly ProjectBudgetLineItem[] {
  const groups = new Map<string, { readonly assembly: LineAssembly; readonly lines: ProjectBudgetLineItem[] }>()
  for (const line of lines) {
    const assembly = assemblies.get(line.id) ?? { key: "", name: UNASSIGNED_ASSEMBLY_NAME, sort: 1_000_000 }
    const group = groups.get(assembly.key) ?? { assembly, lines: [] }
    group.lines.push(line)
    groups.set(assembly.key, group)
  }
  return [...groups.values()]
    .sort((left, right) => left.assembly.sort - right.assembly.sort || left.assembly.name.localeCompare(right.assembly.name))
    .map((group, index) => {
      const sum = (pick: (line: ProjectBudgetLineItem) => number): number =>
        group.lines.reduce((total, line) => total + pick(line), 0)
      const adjustedEstimate = sum((line) => line.adjustedEstimate)
      const totalCosts = sum((line) => line.totalCosts)
      const position = String(index + 1).padStart(2, "0")
      return {
        id: `owner-budget-assembly-${group.assembly.key || "other"}`,
        sourceSystem: group.lines[0]?.sourceSystem ?? "compass",
        costCode: position,
        csiDivision: position,
        csiDivisionName: group.assembly.name,
        description: group.assembly.name,
        notes: null,
        originalEstimate: sum((line) => line.originalEstimate),
        priorChanges: sum((line) => line.priorChanges),
        currentChanges: sum((line) => line.currentChanges),
        totalChanges: sum((line) => line.totalChanges),
        adjustedEstimate,
        priorCosts: sum((line) => line.priorCosts),
        currentCosts: sum((line) => line.currentCosts),
        totalCosts,
        percentComplete: percent(totalCosts, adjustedEstimate),
        balanceToFinish: sum((line) => line.balanceToFinish),
        retainageHeld: sum((line) => line.retainageHeld),
        vendorName: null,
        ownerLabel: group.assembly.name,
        ownerVisible: true,
        internalNotes: null,
      }
    })
}

export async function getProjectBudgetSummary(
  projectId: string,
  audience: ProjectBudgetAudience = "internal",
  applicationId?: string
): Promise<ProjectBudgetSummary> {
  const access = await verifyProjectAccess(projectId)
  const effectiveAudience = effectiveProjectBudgetAudience(
    audience,
    access.viewerRole
  )
  const applications =
    effectiveAudience === "owner"
      ? (
          await access.db
            .select({
              id: projectBudgetApplications.id,
              sourceSystem: projectBudgetApplications.sourceSystem,
              applicationNumber: projectBudgetApplications.applicationNumber,
              periodTo: projectBudgetApplications.periodTo,
              status: projectBudgetApplications.status,
              syncStatus: projectBudgetApplications.syncStatus,
              originalContractSum:
                projectBudgetApplications.originalContractSum,
              netChanges: projectBudgetApplications.netChanges,
              contractSumToDate: projectBudgetApplications.contractSumToDate,
              totalCompletedStoredToDate:
                projectBudgetApplications.totalCompletedStoredToDate,
              retainageHeld: projectBudgetApplications.retainageHeld,
              totalEarnedLessRetainage:
                projectBudgetApplications.totalEarnedLessRetainage,
              previousCertificates:
                projectBudgetApplications.previousCertificates,
              currentPaymentDue: projectBudgetApplications.currentPaymentDue,
              balanceToFinish: projectBudgetApplications.balanceToFinish,
              ownerVisible: projectBudgetApplications.ownerVisible,
              documentAvailable: sql<number>`
                case
                  when ${projectBudgetApplications.sourceSystem} = 'google_drive_g702_g703'
                    and ${projectBudgetApplications.sourceRecordId} is not null
                  then 1
                  else 0
                end
              `,
            })
            .from(projectBudgetApplications)
            .where(
              and(
                eq(projectBudgetApplications.projectId, projectId),
                eq(projectBudgetApplications.ownerVisible, true),
                ne(projectBudgetApplications.status, "building")
              )
            )
            .orderBy(
              desc(projectBudgetApplications.periodTo),
              desc(projectBudgetApplications.createdAt)
            )
        ).map(({ syncStatus, ...row }) =>
          sanitizeBudgetApplicationForOwner({
            ...row,
            status: budgetApplicationStatus({ ...row, syncStatus }),
            documentAvailable: Boolean(row.documentAvailable),
            sourceUrl: null,
            lastSyncedAt: null,
          })
        )
      : (
          await access.db
            .select()
            .from(projectBudgetApplications)
            .where(
              and(
                eq(projectBudgetApplications.projectId, projectId),
                ne(projectBudgetApplications.status, "building")
              )
            )
            .orderBy(
              desc(projectBudgetApplications.periodTo),
              desc(projectBudgetApplications.createdAt)
            )
        ).map((row) => toApplicationItem(row, effectiveAudience))

  const currentApplication = selectBudgetApplication(
    applications,
    applicationId
  )
  const detailMode: ProjectBudgetDetailMode =
    effectiveAudience === "owner"
      ? await ownerDetailMode(access, currentApplication?.id ?? null)
      : "cost_code"

  const sourceLines: readonly ProjectBudgetLineItem[] = currentApplication
    ? effectiveAudience === "owner"
      ? scopeBudgetLinesToApplication(
          (
            await access.db
              .select({
                applicationId: projectBudgetLines.applicationId,
                id: projectBudgetLines.id,
                sourceSystem: projectBudgetLines.sourceSystem,
                costCode: projectBudgetLines.costCode,
                csiDivision: projectBudgetLines.csiDivision,
                csiDivisionName: projectBudgetLines.csiDivisionName,
                description: projectBudgetLines.description,
                originalEstimate: projectBudgetLines.originalEstimate,
                priorChanges: projectBudgetLines.priorChanges,
                currentChanges: projectBudgetLines.currentChanges,
                totalChanges: projectBudgetLines.totalChanges,
                adjustedEstimate: projectBudgetLines.adjustedEstimate,
                priorCosts: projectBudgetLines.priorCosts,
                currentCosts: projectBudgetLines.currentCosts,
                totalCosts: projectBudgetLines.totalCosts,
                percentComplete: projectBudgetLines.percentComplete,
                balanceToFinish: projectBudgetLines.balanceToFinish,
                retainageHeld: projectBudgetLines.retainageHeld,
                ownerLabel: projectBudgetLines.ownerLabel,
                ownerVisible: projectBudgetLines.ownerVisible,
              })
              .from(projectBudgetLines)
              .where(
                and(
                  eq(projectBudgetLines.projectId, projectId),
                  eq(projectBudgetLines.applicationId, currentApplication.id),
                  eq(projectBudgetLines.ownerVisible, true)
                )
              )
              .orderBy(
                asc(projectBudgetLines.sortOrder),
                asc(projectBudgetLines.costCode)
              )
          ).map(
            (row): BudgetLineSnapshotRow => ({
              ...row,
              notes: null,
              vendorName: null,
              internalNotes: null,
            })
          ),
          currentApplication.id
        ).map((row) => sanitizeBudgetLineForOwner(row))
      : scopeBudgetLinesToApplication(
          (
            await access.db
              .select()
              .from(projectBudgetLines)
              .where(
                and(
                  eq(projectBudgetLines.projectId, projectId),
                  eq(projectBudgetLines.applicationId, currentApplication.id)
                )
              )
              .orderBy(
                asc(projectBudgetLines.sortOrder),
                asc(projectBudgetLines.costCode)
              )
          ).map((row) => ({
            ...toLineItem(row, effectiveAudience),
            applicationId: row.applicationId,
          })),
          currentApplication.id
        )
    : []
  const assemblyMode = detailMode === "assembly" || detailMode === "assembly_percent"
  const rolledUpLines =
    detailMode === "cost_code"
      ? combineByCostCode(sourceLines)
      : assemblyMode && currentApplication
        ? await assemblyLines(access, currentApplication.id, sourceLines)
        : buildOwnerCategoryLines(sourceLines)
  const rolledUpDivisions = buildDivisions(rolledUpLines)
  const percentOnly = detailMode === "category_percent" || detailMode === "assembly_percent"
  const allLines = percentOnly ? rolledUpLines.map(withoutAmounts) : rolledUpLines
  const divisions = percentOnly
    ? rolledUpDivisions.map((division) => ({
        ...withoutAmounts(division),
        lines: division.lines.map(withoutAmounts),
      }))
    : rolledUpDivisions
  const visiblePercentComplete = percent(
    rolledUpLines.reduce((sum, line) => sum + line.totalCosts, 0),
    rolledUpLines.reduce((sum, line) => sum + line.adjustedEstimate, 0)
  )
  const originalEstimate = allLines.reduce(
    (sum, line) => sum + line.originalEstimate,
    0
  )
  const totalChanges = allLines.reduce(
    (sum, line) => sum + line.totalChanges,
    0
  )
  const adjustedEstimate = allLines.reduce(
    (sum, line) => sum + line.adjustedEstimate,
    0
  )
  const priorCosts = allLines.reduce((sum, line) => sum + line.priorCosts, 0)
  const totalCosts = allLines.reduce((sum, line) => sum + line.totalCosts, 0)
  const currentCosts = allLines.reduce((sum, line) => sum + line.currentCosts, 0)
  const retainageHeld = allLines.reduce(
    (sum, line) => sum + line.retainageHeld,
    0
  )
  const balanceToFinish = allLines.reduce(
    (sum, line) => sum + line.balanceToFinish,
    0
  )

  return {
    audience: effectiveAudience,
    detailMode,
    applications,
    currentApplication,
    // Percentage-only display rows omit amounts; reconcile the authorized
    // source lines and return only the decision, never their monetary totals.
    reconciliation: budgetReconciliationSummary(currentApplication, sourceLines),
    totals: {
      originalEstimate,
      totalChanges,
      adjustedEstimate,
      priorCosts,
      totalCosts,
      currentCosts,
      retainageHeld,
      balanceToFinish,
      percentComplete: visiblePercentComplete,
      overBudgetAmount: Math.max(0, totalCosts - adjustedEstimate),
      ownerVisibleLineCount: allLines.filter((line) => line.ownerVisible).length,
    },
    divisions,
    allLines,
  }
}
