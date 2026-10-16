"use server"

import { and, asc, desc, eq, ne, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  isPayApplicationOwnerDetail,
  type PayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  effectiveProjectBudgetAudience,
  type ProjectBudgetAudience,
} from "@/lib/project-budget-audience"
import {
  sanitizeBudgetApplicationForOwner,
  sanitizeBudgetLineForOwner,
  scopeBudgetLinesToApplication,
  selectBudgetApplication,
  type BudgetLineSnapshotRow,
} from "@/lib/project-budget-snapshot"

export type { ProjectBudgetAudience } from "@/lib/project-budget-audience"
/** "category_percent" shows divisions by percent complete with no amounts. */
export type ProjectBudgetDetailMode = "cost_code" | "category" | "category_percent"

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
  const user = await requireAuth()
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
    status: row.status,
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
        ).map((row) =>
          sanitizeBudgetApplicationForOwner({
            ...row,
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
  const rolledUpLines =
    detailMode === "cost_code" ? sourceLines : buildOwnerCategoryLines(sourceLines)
  const rolledUpDivisions = buildDivisions(rolledUpLines)
  const percentOnly = detailMode === "category_percent"
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
