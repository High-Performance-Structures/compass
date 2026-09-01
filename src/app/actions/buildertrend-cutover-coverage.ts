"use server"

import { and, eq, isNotNull, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  buildertrendArchiveFiles,
  buildertrendModuleAttestations,
  buildertrendSourceRecords,
} from "@/db/schema-buildertrend"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import {
  moduleForArchiveFileType,
  moduleForSourceRecordType,
  summarizeBuildertrendModuleCoverage,
  type BuildertrendCoverageEvidence,
  type BuildertrendCoverageSummary,
} from "@/lib/buildertrend/module-coverage"
import { requireOrg } from "@/lib/org-scope"
import { canManageProjectRegistry } from "@/lib/permissions"

export type BuildertrendCutoverStatusCount = {
  readonly status: string
  readonly count: number
}

export type BuildertrendCutoverCoverage = BuildertrendCoverageSummary & {
  readonly generatedAt: string
  readonly statusCounts: readonly BuildertrendCutoverStatusCount[]
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function getBuildertrendCutoverCoverage(): Promise<BuildertrendCutoverCoverage> {
  const user = await requireAuth()
  if (!canManageProjectRegistry(user)) {
    throw new Error("Project administration permission is required")
  }
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const projectRows = await db
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNotNull(projects.buildertrendProjectId)
      )
    )

  const sourceGroups = await db
    .select({
      projectId: buildertrendSourceRecords.projectId,
      sourceRecordType: buildertrendSourceRecords.sourceRecordType,
      // Import waves may retain multiple immutable captures of the same
      // Buildertrend entity. Coverage measures source entities, not capture
      // rows, so prefer the upstream job/lead + record identity and fall back
      // to the source key only when Buildertrend did not expose a record ID.
      recordCount: sql<number>`count(distinct (
        coalesce(${buildertrendSourceRecords.buildertrendJobId}, '') || char(31) ||
        coalesce(${buildertrendSourceRecords.buildertrendLeadId}, '') || char(31) ||
        coalesce(${buildertrendSourceRecords.buildertrendRecordId}, ${buildertrendSourceRecords.sourceKey})
      ))`,
    })
    .from(buildertrendSourceRecords)
    .where(
      and(
        eq(buildertrendSourceRecords.organizationId, organizationId),
        isNotNull(buildertrendSourceRecords.projectId)
      )
    )
    .groupBy(
      buildertrendSourceRecords.projectId,
      buildertrendSourceRecords.sourceRecordType
    )

  const fileGroups = await db
    .select({
      projectId: buildertrendArchiveFiles.projectId,
      sourceRecordType: buildertrendArchiveFiles.sourceRecordType,
      recordCount: sql<number>`count(*)`,
    })
    .from(buildertrendArchiveFiles)
    .where(
      and(
        eq(buildertrendArchiveFiles.organizationId, organizationId),
        isNotNull(buildertrendArchiveFiles.projectId)
      )
    )
    .groupBy(
      buildertrendArchiveFiles.projectId,
      buildertrendArchiveFiles.sourceRecordType
    )

  const evidence: BuildertrendCoverageEvidence[] = []
  for (const group of sourceGroups) {
    if (!group.projectId) continue
    const moduleKey = moduleForSourceRecordType(group.sourceRecordType)
    if (!moduleKey) continue
    evidence.push({
      projectId: group.projectId,
      moduleKey,
      recordCount: numberValue(group.recordCount),
    })
  }
  for (const group of fileGroups) {
    if (!group.projectId) continue
    const moduleKey = moduleForArchiveFileType(group.sourceRecordType)
    if (!moduleKey) continue
    evidence.push({
      projectId: group.projectId,
      moduleKey,
      recordCount: numberValue(group.recordCount),
    })
  }

  const attestationRows = await db
    .select({
      projectId: buildertrendModuleAttestations.projectId,
      moduleKey: buildertrendModuleAttestations.moduleKey,
      status: buildertrendModuleAttestations.status,
      observedCount: buildertrendModuleAttestations.observedCount,
      checkedAt: buildertrendModuleAttestations.checkedAt,
    })
    .from(buildertrendModuleAttestations)
    .where(eq(buildertrendModuleAttestations.organizationId, organizationId))

  const generatedAt = new Date().toISOString()
  const summary = summarizeBuildertrendModuleCoverage(
    projectRows.map((project) => ({ id: project.id, status: project.status })),
    evidence,
    attestationRows,
    generatedAt
  )
  const statusCounts = new Map<string, number>()
  for (const project of projectRows) {
    statusCounts.set(project.status, (statusCounts.get(project.status) ?? 0) + 1)
  }

  return {
    ...summary,
    generatedAt,
    statusCounts: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((left, right) => left.status.localeCompare(right.status)),
  }
}
