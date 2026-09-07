"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, ne } from "drizzle-orm"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import { getDb } from "@/db"
import {
  projectDuplicateDecisions,
  projectExternalLinks,
  projectMembers,
  projectNumberAliases,
  projectRouteAliases,
  projects,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  compareProjectDuplicateIdentity,
  type ProjectDuplicateCandidate,
  type ProjectDuplicateIdentity,
} from "@/lib/project-duplicate-detector"
import { loadOpenProjectDuplicateCandidates } from "@/lib/project-duplicate-store"
import {
  projectMergeDependencyTableNames,
  summarizeProjectMergeImpact,
  type ProjectMergeImpact,
  type ProjectMergeSchemaRow,
  type ProjectMergeTableCount,
} from "@/lib/project-merge-impact"
import { isExactProjectNumberReviewMerge } from "@/lib/project-number-review"
import { requireOrg } from "@/lib/org-scope"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"

type ProjectDuplicateActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type MergeProjectDuplicateResult =
  | { readonly success: true; readonly keptProjectId: string }
  | { readonly success: false; readonly error: string }

type ProjectMergeImpactResult =
  | { readonly success: true; readonly impact: ProjectMergeImpact }
  | { readonly success: false; readonly error: string }

function orderedPair(
  firstProjectId: string,
  secondProjectId: string,
): readonly [string, string] {
  return firstProjectId < secondProjectId
    ? [firstProjectId, secondProjectId]
    : [secondProjectId, firstProjectId]
}

async function duplicateActionContext(action: "read" | "update" | "delete") {
  const user = await requireAuth()
  requirePermission(user, "project", action)
  if (!canManageProjectRegistry(user)) {
    throw new Error("Permission denied: project registry is admin-only")
  }
  if (isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")

  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  if (!env?.DB) throw new Error("D1 not available")
  return { user, organizationId, db: getDb(env.DB), d1: env.DB }
}

function quotedProjectDependencyTable(tableName: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error("Unsafe project dependency table name")
  }
  // Table names come from sqlite_master and cannot be bound as SQL values.
  return `"${tableName}"`
}

function projectDependencyTable(tableName: string) {
  quotedProjectDependencyTable(tableName)
  return sqliteTable(tableName, {
    projectId: text("project_id"),
  })
}

type DrizzleQuery = {
  readonly toSQL: () => {
    readonly sql: string
    readonly params: readonly unknown[]
  }
}

function prepareDrizzleQuery(
  d1: D1Database,
  query: DrizzleQuery,
): D1PreparedStatement {
  const compiled = query.toSQL()
  return d1.prepare(compiled.sql).bind(...compiled.params)
}

async function loadProjectDependencyTables(
  d1: D1Database,
): Promise<readonly string[]> {
  const result = await d1
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%project_id%' ORDER BY name",
    )
    .all<ProjectMergeSchemaRow>()
  return projectMergeDependencyTableNames(result.results)
}

function projectDependencyCount(
  result: D1Result<Record<string, unknown>> | undefined,
): number {
  const row = result?.results[0]
  return row && typeof row.record_count === "number" ? row.record_count : 0
}

async function loadProjectMergeImpact(
  d1: D1Database,
  removedProjectId: string,
): Promise<{
  readonly impact: ProjectMergeImpact
  readonly tableNames: readonly string[]
}> {
  const tableNames = await loadProjectDependencyTables(d1)
  const countResults = await d1.batch<Record<string, unknown>>(
    tableNames.map((tableName) =>
      d1
        .prepare(
          `SELECT COUNT(*) AS record_count FROM ${quotedProjectDependencyTable(tableName)} WHERE project_id = ?`,
        )
        .bind(removedProjectId),
    ),
  )
  const tableCounts: readonly ProjectMergeTableCount[] = tableNames.map(
    (tableName, index) => ({
      tableName,
      recordCount: projectDependencyCount(countResults[index]),
    }),
  )
  return { impact: summarizeProjectMergeImpact(tableCounts), tableNames }
}

function identityFromRow(row: ProjectDuplicateIdentity): ProjectDuplicateIdentity {
  return row
}

export async function getProjectDuplicateCandidates(): Promise<
  readonly ProjectDuplicateCandidate[]
> {
  try {
    const { db, organizationId } = await duplicateActionContext("read")
    const candidates = await loadOpenProjectDuplicateCandidates(
      db,
      organizationId,
    )
    return candidates.slice(0, 50)
  } catch {
    return []
  }
}

export async function getProjectMergeImpact(input: {
  readonly keptProjectId: string
  readonly removedProjectId: string
}): Promise<ProjectMergeImpactResult> {
  try {
    if (input.keptProjectId === input.removedProjectId) {
      return { success: false, error: "Choose two different projects." }
    }
    const { db, d1, organizationId } = await duplicateActionContext("read")
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          inArray(projects.id, [input.keptProjectId, input.removedProjectId]),
        ),
      )
    if (rows.length !== 2) {
      return { success: false, error: "One or both projects were not found." }
    }

    const { impact } = await loadProjectMergeImpact(d1, input.removedProjectId)
    return { success: true, impact }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not inventory the project records.",
    }
  }
}

export async function confirmProjectsAreDistinct(input: {
  readonly firstProjectId: string
  readonly secondProjectId: string
}): Promise<ProjectDuplicateActionResult> {
  try {
    const { db, organizationId, user } = await duplicateActionContext("update")
    const projectIds = Array.from(
      new Set([input.firstProjectId, input.secondProjectId]),
    )
    if (projectIds.length !== 2) {
      return { success: false, error: "Choose two different projects." }
    }
    const rows = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        clientName: projects.clientName,
        address: projects.address,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
        buildertrendProjectId: projects.buildertrendProjectId,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          inArray(projects.id, projectIds),
        ),
      )
    if (rows.length !== 2) {
      return { success: false, error: "One or both projects were not found." }
    }

    const [projectAId, projectBId] = orderedPair(projectIds[0] ?? "", projectIds[1] ?? "")
    const first = rows.find((row) => row.id === input.firstProjectId)
    const second = rows.find((row) => row.id === input.secondProjectId)
    if (!first || !second) {
      return { success: false, error: "One or both projects were not found." }
    }
    const match = compareProjectDuplicateIdentity(
      identityFromRow(first),
      identityFromRow(second),
    )
    const now = new Date().toISOString()
    const savedDecisions = await db
      .insert(projectDuplicateDecisions)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        projectAId,
        projectBId,
        status: "not_duplicate",
        keptProjectId: null,
        removedProjectId: null,
        score: match?.score ?? 0,
        reasonsJson: JSON.stringify(match?.reasons ?? []),
        removedProjectSnapshotJson: null,
        resolvedByUserId: user.id,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectDuplicateDecisions.organizationId,
          projectDuplicateDecisions.projectAId,
          projectDuplicateDecisions.projectBId,
        ],
        set: {
          status: "not_duplicate",
          keptProjectId: null,
          removedProjectId: null,
          score: match?.score ?? 0,
          reasonsJson: JSON.stringify(match?.reasons ?? []),
          removedProjectSnapshotJson: null,
          resolvedByUserId: user.id,
          resolvedAt: now,
          updatedAt: now,
        },
        setWhere: ne(projectDuplicateDecisions.status, "merged"),
      })
      .returning({ status: projectDuplicateDecisions.status })

    if (!savedDecisions[0]) {
      return {
        success: false,
        error: "These projects have already been merged and cannot be marked as separate.",
      }
    }

    revalidatePath("/dashboard/projects")
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save the duplicate decision.",
    }
  }
}

export async function mergeDuplicateProjects(input: {
  readonly keptProjectId: string
  readonly removedProjectId: string
  readonly confirmationProjectId: string
}): Promise<MergeProjectDuplicateResult> {
  try {
    if (
      input.keptProjectId === input.removedProjectId ||
      input.confirmationProjectId !== input.removedProjectId
    ) {
      return {
        success: false,
        error: "Confirm the exact project that will be removed from the registry.",
      }
    }
    const { db, d1, organizationId, user } = await duplicateActionContext("delete")
    const rows = await db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        clientName: projects.clientName,
        address: projects.address,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
        googleScheduleSheetId: projects.googleScheduleSheetId,
        googleDailyLogSheetId: projects.googleDailyLogSheetId,
        googleCalendarId: projects.googleCalendarId,
        buildertrendProjectId: projects.buildertrendProjectId,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          inArray(projects.id, [input.keptProjectId, input.removedProjectId]),
        ),
      )
    const kept = rows.find((row) => row.id === input.keptProjectId)
    const removed = rows.find((row) => row.id === input.removedProjectId)
    if (!kept || !removed) {
      return { success: false, error: "One or both projects were not found." }
    }
    const detectedMatch = compareProjectDuplicateIdentity(kept, removed)
    const approvedNumberReviewMerge = isExactProjectNumberReviewMerge({
      reviewedProjectNumber: removed.projectNumber,
      reviewedProjectName: removed.name,
      keptProjectNumber: kept.projectNumber,
    })
    const match =
      detectedMatch ??
      (approvedNumberReviewMerge
        ? {
            score: 100,
            confidence: "high" as const,
            reasons: [
              {
                code: "project_number" as const,
                label: "Approved project number matches the reviewed cutover number",
                weight: 100,
              },
            ],
          }
        : null)
    if (!match) {
      return {
        success: false,
        error:
          "These projects no longer meet the duplicate warning threshold, and the approved number does not exactly match the reviewed cutover number.",
      }
    }

    const existingAliases = await db
      .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
      .from(projectRouteAliases)
      .where(
        inArray(projectRouteAliases.sourceProjectId, [
          input.keptProjectId,
          input.removedProjectId,
        ]),
      )
    if (existingAliases.some((alias) => alias.sourceProjectId === kept.id)) {
      return {
        success: false,
        error: "The selected project to keep has already been merged into another project.",
      }
    }
    if (existingAliases.some((alias) => alias.sourceProjectId === removed.id)) {
      return {
        success: false,
        error: "The selected project to remove has already been merged.",
      }
    }

    const { impact, tableNames: dependencyTableNames } =
      await loadProjectMergeImpact(d1, removed.id)

    const [removedMembers, keptMembers, removedLinks, keptLinks] = await Promise.all([
      db.select().from(projectMembers).where(eq(projectMembers.projectId, removed.id)),
      db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, kept.id)),
      db
        .select()
        .from(projectExternalLinks)
        .where(eq(projectExternalLinks.projectId, removed.id)),
      db
        .select({ system: projectExternalLinks.system })
        .from(projectExternalLinks)
        .where(eq(projectExternalLinks.projectId, kept.id)),
    ])
    const keptMemberIds = new Set(keptMembers.map((member) => member.userId))
    const now = new Date().toISOString()
    const [projectAId, projectBId] = orderedPair(kept.id, removed.id)
    const memberStatements = removedMembers
      .filter((member) => !keptMemberIds.has(member.userId))
      .map((member) =>
        db.insert(projectMembers).values({
          id: crypto.randomUUID(),
          projectId: kept.id,
          userId: member.userId,
          role: member.role,
          assignedAt: now,
        }),
      )
    const retainedLinkSystems = new Set(keptLinks.map((link) => link.system))
    const externalLinkCopyStatements = removedLinks
      .filter((link) => {
        if (link.system === "compass" || retainedLinkSystems.has(link.system)) {
          return false
        }
        retainedLinkSystems.add(link.system)
        return true
      })
      .map((link) =>
        db.insert(projectExternalLinks).values({
          ...link,
          id: crypto.randomUUID(),
          projectId: kept.id,
          metadata: JSON.stringify({
            copiedFromProjectId: removed.id,
            sourceMetadata: link.metadata,
          }),
          updatedAt: now,
        }),
      )
    const dependencyTransferStatements = dependencyTableNames.map((tableName) => {
      const table = projectDependencyTable(tableName)
      return db
        .update(table)
        .set({ projectId: kept.id })
        .where(eq(table.projectId, removed.id))
    })
    const removedProjectSnapshotJson = JSON.stringify({
      project: removed,
      transferredRecords: impact,
    })

    const mergeQueries: readonly DrizzleQuery[] = [
      db
        .update(projects)
        // Release the active number before a later statement either transfers
        // or reserves it. The pre-merge row remains in the audit snapshot.
        .set({ projectNumber: null, status: "ARCHIVE", updatedAt: now })
        .where(eq(projects.id, removed.id)),
      ...dependencyTransferStatements,
      db
        .update(projects)
        .set({
          projectNumber: kept.projectNumber ?? removed.projectNumber,
          sageJobId: kept.sageJobId ?? removed.sageJobId,
          sageJobNumber: kept.sageJobNumber ?? removed.sageJobNumber,
          googleDriveFolderId:
            kept.googleDriveFolderId ?? removed.googleDriveFolderId,
          googleScheduleSheetId:
            kept.googleScheduleSheetId ?? removed.googleScheduleSheetId,
          googleDailyLogSheetId:
            kept.googleDailyLogSheetId ?? removed.googleDailyLogSheetId,
          googleCalendarId: kept.googleCalendarId ?? removed.googleCalendarId,
          buildertrendProjectId:
            kept.buildertrendProjectId ?? removed.buildertrendProjectId,
          updatedAt: now,
        })
        .where(eq(projects.id, kept.id)),
      db.insert(projectRouteAliases).values({
        sourceProjectId: removed.id,
        targetProjectId: kept.id,
        organizationId,
        sourceSystem: "compass",
        sourceExternalId: removed.id,
        reason: "duplicate_registry_merge",
        createdAt: now,
      }),
      ...externalLinkCopyStatements,
      ...(removed.projectNumber && kept.projectNumber
        ? [
            db
              .insert(projectNumberAliases)
              .values({
                id: crypto.randomUUID(),
                organizationId,
                projectId: kept.id,
                projectNumber: removed.projectNumber,
                createdBy: user.id,
                createdAt: now,
              })
              .onConflictDoNothing(),
          ]
        : []),
      db.insert(projectExternalLinks).values({
        id: crypto.randomUUID(),
        projectId: kept.id,
        system: "compass_merged_source",
        label: `Archived duplicate: ${removed.name}`,
        externalId: removed.id,
        externalNumber: removed.projectNumber,
        externalUrl: `/dashboard/projects/${removed.id}?mergedSource=1`,
        syncDirection: "read",
        syncStatus: "mapped",
        metadata: JSON.stringify({ mergedAt: now, mergedByUserId: user.id }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(projectExternalLinks).values({
        id: crypto.randomUUID(),
        projectId: removed.id,
        system: "compass_merged_into",
        label: `Merged into: ${kept.name}`,
        externalId: kept.id,
        externalNumber: kept.projectNumber,
        externalUrl: `/dashboard/projects/${kept.id}`,
        syncDirection: "read",
        syncStatus: "mapped",
        metadata: JSON.stringify({ mergedAt: now, mergedByUserId: user.id }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      ...memberStatements,
      db
        .insert(projectDuplicateDecisions)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          projectAId,
          projectBId,
          status: "merged",
          keptProjectId: kept.id,
          removedProjectId: removed.id,
          score: match.score,
          reasonsJson: JSON.stringify(match.reasons),
          removedProjectSnapshotJson,
          resolvedByUserId: user.id,
          resolvedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            projectDuplicateDecisions.organizationId,
            projectDuplicateDecisions.projectAId,
            projectDuplicateDecisions.projectBId,
          ],
          set: {
            status: "merged",
            keptProjectId: kept.id,
            removedProjectId: removed.id,
            score: match.score,
            reasonsJson: JSON.stringify(match.reasons),
            removedProjectSnapshotJson,
            resolvedByUserId: user.id,
            resolvedAt: now,
            updatedAt: now,
          },
        }),
    ]
    await d1.batch([
      // Some child rows include project_id in composite foreign keys. D1
      // validates the final state at commit so parents and children can move
      // together without ever disabling foreign-key enforcement.
      d1.prepare("PRAGMA defer_foreign_keys = ON"),
      ...mergeQueries.map((query) => prepareDrizzleQuery(d1, query)),
    ])

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${kept.id}`)
    revalidatePath("/dashboard/files")
    return { success: true, keptProjectId: kept.id }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return {
        success: false,
        error:
          "The projects contain conflicting linked records. Nothing was merged. Review the duplicate documents or project records, then try again.",
      }
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Could not merge the projects.",
    }
  }
}
