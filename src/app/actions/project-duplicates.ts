"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, ne } from "drizzle-orm"

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
  return { user, organizationId, db: getDb(env.DB) }
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
    const { db, organizationId, user } = await duplicateActionContext("delete")
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
    const match = compareProjectDuplicateIdentity(kept, removed)
    if (!match) {
      return {
        success: false,
        error: "These projects no longer meet the duplicate warning threshold.",
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

    await db.batch([
      db
        .update(projects)
        // Release the active number before a later statement either transfers
        // or reserves it. The pre-merge row remains in the audit snapshot.
        .set({ projectNumber: null, status: "ARCHIVE", updatedAt: now })
        .where(eq(projects.id, removed.id)),
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
          removedProjectSnapshotJson: JSON.stringify(removed),
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
            removedProjectSnapshotJson: JSON.stringify(removed),
            resolvedByUserId: user.id,
            resolvedAt: now,
            updatedAt: now,
          },
        }),
    ])

    revalidatePath("/dashboard/projects")
    revalidatePath(`/dashboard/projects/${kept.id}`)
    revalidatePath("/dashboard/files")
    return { success: true, keptProjectId: kept.id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Could not merge the projects.",
    }
  }
}
