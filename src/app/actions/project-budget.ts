"use server"

import { and, asc, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projects,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectBudgetAudience = "internal" | "owner"
export type ProjectBudgetDetailMode = "cost_code" | "category"

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
  readonly totalCosts: number
  readonly currentCosts: number
  readonly balanceToFinish: number
  readonly percentComplete: number
  readonly lineCount: number
  readonly lines: readonly ProjectBudgetLineItem[]
}

export type ProjectBudgetTotals = {
  readonly adjustedEstimate: number
  readonly totalCosts: number
  readonly currentCosts: number
  readonly balanceToFinish: number
  readonly percentComplete: number
  readonly overBudgetAmount: number
  readonly ownerVisibleLineCount: number
}

export type ProjectBudgetSummary = {
  readonly audience: ProjectBudgetAudience
  readonly detailMode: ProjectBudgetDetailMode
  readonly currentApplication: ProjectBudgetApplicationItem | null
  readonly totals: ProjectBudgetTotals
  readonly divisions: readonly ProjectBudgetDivision[]
  readonly allLines: readonly ProjectBudgetLineItem[]
}

type ProjectAccess = {
  readonly db: ReturnType<typeof getDb>
  readonly projectNumber: string | null
}

async function verifyProjectAccess(projectId: string): Promise<ProjectAccess> {
  const user = await requireAuth()
  requirePermission(user, "budget", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  const project = existing[0]
  if (!project) {
    throw new Error("Project not found")
  }

  return { db, projectNumber: project.projectNumber }
}

function toApplicationItem(
  row: typeof projectBudgetApplications.$inferSelect
): ProjectBudgetApplicationItem {
  return {
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
    sourceUrl: row.sourceUrl,
    lastSyncedAt: row.lastSyncedAt,
  }
}

function toLineItem(
  row: typeof projectBudgetLines.$inferSelect
): ProjectBudgetLineItem {
  return {
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
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function ownerDetailMode(projectNumber: string | null): ProjectBudgetDetailMode {
  if (projectNumber?.slice(0, 1).toUpperCase() === "H") {
    return "category"
  }

  return "cost_code"
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
    const currentCosts = items.reduce((sum, item) => sum + item.currentCosts, 0)
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
      totalCosts,
      currentCosts,
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
      sourceSystem: firstLine?.sourceSystem ?? "sage",
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
  audience: ProjectBudgetAudience = "internal"
): Promise<ProjectBudgetSummary> {
  const access = await verifyProjectAccess(projectId)
  const detailMode =
    audience === "owner" ? ownerDetailMode(access.projectNumber) : "cost_code"

  const applicationRows = await access.db
    .select()
    .from(projectBudgetApplications)
    .where(
      audience === "owner"
        ? and(
            eq(projectBudgetApplications.projectId, projectId),
            eq(projectBudgetApplications.ownerVisible, true)
          )
        : eq(projectBudgetApplications.projectId, projectId)
    )
    .orderBy(desc(projectBudgetApplications.periodTo))
    .limit(1)

  const currentApplication = applicationRows[0]
    ? toApplicationItem(applicationRows[0])
    : null

  const lineRows = await access.db
    .select()
    .from(projectBudgetLines)
    .where(
      audience === "owner"
        ? and(
            eq(projectBudgetLines.projectId, projectId),
            eq(projectBudgetLines.ownerVisible, true)
          )
        : eq(projectBudgetLines.projectId, projectId)
    )
    .orderBy(asc(projectBudgetLines.sortOrder), asc(projectBudgetLines.costCode))

  const sourceLines = lineRows.map(toLineItem)
  const allLines =
    detailMode === "category" ? buildOwnerCategoryLines(sourceLines) : sourceLines
  const divisions = buildDivisions(allLines)
  const adjustedEstimate = allLines.reduce(
    (sum, line) => sum + line.adjustedEstimate,
    0
  )
  const totalCosts = allLines.reduce((sum, line) => sum + line.totalCosts, 0)
  const currentCosts = allLines.reduce((sum, line) => sum + line.currentCosts, 0)
  const balanceToFinish = allLines.reduce(
    (sum, line) => sum + line.balanceToFinish,
    0
  )

  return {
    audience,
    detailMode,
    currentApplication,
    totals: {
      adjustedEstimate,
      totalCosts,
      currentCosts,
      balanceToFinish,
      percentComplete: percent(totalCosts, adjustedEstimate),
      overBudgetAmount: Math.max(0, totalCosts - adjustedEstimate),
      ownerVisibleLineCount: allLines.filter((line) => line.ownerVisible).length,
    },
    divisions,
    allLines,
  }
}
