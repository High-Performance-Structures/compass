"use server"

import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { projectChangeOrders, projects } from "@/db/schema"
import {
  buildertrendImportObservations,
  buildertrendSourceRecords,
} from "@/db/schema-buildertrend"
import { requireAuth } from "@/lib/auth"
import {
  parseArchivedBuildertrendChangeOrder,
  type ArchivedBuildertrendChangeOrder,
} from "@/lib/change-orders/buildertrend-archive"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const MAX_ARCHIVED_RECORDS = 100
const FORBIDDEN_ERROR =
  "Archived change-order evidence is available only to authorized internal staff."
const LOAD_ERROR =
  "Archived change-order evidence could not be loaded. Historical source records may still exist."

export type ArchivedBuildertrendChangeOrderHold = {
  readonly sourceRecordId: string
  readonly reason: string
}

export type ProjectArchivedChangeOrderWorkspace =
  | {
      readonly success: true
      readonly projectId: string
      readonly records: readonly ArchivedBuildertrendChangeOrder[]
      readonly holds: readonly ArchivedBuildertrendChangeOrderHold[]
    }
  | {
      readonly success: false
      readonly reason: "forbidden" | "not_applicable" | "load_error"
      readonly error: string
    }

/** Internal source history only. Never call this from an owner or vendor route. */
export async function getProjectArchivedBuildertrendChangeOrders(
  projectId: string
): Promise<ProjectArchivedChangeOrderWorkspace> {
  const user = await requireAuth().catch(() => null)
  if (
    !user ||
    !user.isActive ||
    isDemoUser(user.id) ||
    user.organizationType !== "internal" ||
    !isInternalStaffRole(user.role)
  ) {
    return {
      success: false,
      reason: "forbidden",
      error: FORBIDDEN_ERROR,
    }
  }
  let organizationId: string
  try {
    await requireFeaturePermission(user, "change-orders", "read")
    organizationId = requireOrg(user)
  } catch {
    return { success: false, reason: "forbidden", error: FORBIDDEN_ERROR }
  }
  const db = await (async () => {
    const { env } = await getCloudflareContext()
    return getDb(env.DB)
  })().catch(() => null)
  if (!db) {
    return { success: false, reason: "load_error", error: LOAD_ERROR }
  }
  try {
    await assertProjectAccess(db, user, projectId)
  } catch {
    return { success: false, reason: "forbidden", error: FORBIDDEN_ERROR }
  }
  try {
    const project = await db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        buildertrendJobId: projects.buildertrendProjectId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1)
      .get()
    if (!project?.buildertrendJobId) {
      return {
        success: false,
        reason: "not_applicable",
        error: "Archived change-order project identity is not available.",
      }
    }
    const sourceRows = await db
      .select({
        id: buildertrendSourceRecords.id,
        organizationId: buildertrendSourceRecords.organizationId,
        projectId: buildertrendSourceRecords.projectId,
        requestedProjectId: buildertrendSourceRecords.requestedProjectId,
        sourceKey: buildertrendSourceRecords.sourceKey,
        sourceRecordType: buildertrendSourceRecords.sourceRecordType,
        buildertrendJobId: buildertrendSourceRecords.buildertrendJobId,
        buildertrendRecordId: buildertrendSourceRecords.buildertrendRecordId,
        buildertrendRecordNumber:
          buildertrendSourceRecords.buildertrendRecordNumber,
        buildertrendUrl: buildertrendSourceRecords.buildertrendUrl,
        title: buildertrendSourceRecords.title,
        sourceStatus: buildertrendSourceRecords.sourceStatus,
        clientName: buildertrendSourceRecords.clientName,
        rawPayloadJson: buildertrendSourceRecords.rawPayloadJson,
        verifiedArchiveDriveFileId:
          buildertrendSourceRecords.verifiedArchiveDriveFileId,
        verifiedArchiveDriveUrl:
          buildertrendSourceRecords.verifiedArchiveDriveUrl,
        reviewStatus: buildertrendSourceRecords.reviewStatus,
        promotionStatus: buildertrendSourceRecords.promotionStatus,
        updatedAt: buildertrendSourceRecords.updatedAt,
      })
      .from(buildertrendSourceRecords)
      .where(
        and(
          eq(buildertrendSourceRecords.organizationId, organizationId),
          eq(buildertrendSourceRecords.projectId, projectId),
          eq(buildertrendSourceRecords.sourceRecordType, "change_order"),
          eq(buildertrendSourceRecords.reviewStatus, "verified"),
          eq(buildertrendSourceRecords.promotionStatus, "archive_only")
        )
      )
      .orderBy(desc(buildertrendSourceRecords.updatedAt))
      .limit(MAX_ARCHIVED_RECORDS + 1)
    if (sourceRows.length > MAX_ARCHIVED_RECORDS) {
      return {
        success: false,
        reason: "load_error",
        error: "Archived change-order evidence exceeds the bounded review window.",
      }
    }
    const sourceIds = sourceRows.flatMap((row) =>
      row.buildertrendRecordId ? [row.buildertrendRecordId] : []
    )
    const nativeRows =
      sourceIds.length === 0
        ? []
        : await db
            .select({ sourceRecordId: projectChangeOrders.sourceRecordId })
            .from(projectChangeOrders)
            .where(
              and(
                eq(projectChangeOrders.projectId, projectId),
                eq(projectChangeOrders.sourceType, "buildertrend_import"),
                inArray(projectChangeOrders.sourceRecordId, sourceIds)
              )
            )
    const nativeSourceIds = new Set(
      nativeRows.flatMap((row) =>
        row.sourceRecordId ? [row.sourceRecordId] : []
      )
    )
    const archiveRows = sourceRows.filter(
      (row) =>
        !row.buildertrendRecordId ||
        !nativeSourceIds.has(row.buildertrendRecordId)
    )
    const rowIds = archiveRows.map((row) => row.id)
    const observations =
      rowIds.length === 0
        ? []
        : await db
            .select({
              id: buildertrendImportObservations.id,
              organizationId: buildertrendImportObservations.organizationId,
              entityKind: buildertrendImportObservations.entityKind,
              entityKey: buildertrendImportObservations.entityKey,
              entityId: buildertrendImportObservations.entityId,
              observedPayloadJson:
                buildertrendImportObservations.observedPayloadJson,
              observedAt: buildertrendImportObservations.observedAt,
            })
            .from(buildertrendImportObservations)
            .where(
              and(
                eq(buildertrendImportObservations.organizationId, organizationId),
                eq(buildertrendImportObservations.entityKind, "record"),
                inArray(buildertrendImportObservations.entityId, rowIds)
              )
            )
            .orderBy(
              desc(buildertrendImportObservations.observedAt),
              desc(buildertrendImportObservations.id)
            )
    const records: ArchivedBuildertrendChangeOrder[] = []
    const holds: ArchivedBuildertrendChangeOrderHold[] = []
    for (const row of archiveRows) {
      const observation = observations.find(
        (candidate) =>
          candidate.entityId === row.id && candidate.entityKey === row.sourceKey
      )
      if (!observation) {
        holds.push({
          sourceRecordId: row.id,
          reason: "Matching immutable source evidence is not available.",
        })
        continue
      }
      const parsed = parseArchivedBuildertrendChangeOrder({
        projectId,
        buildertrendJobId: project.buildertrendJobId,
        row,
        observation,
      })
      if (parsed.kind === "record") records.push(parsed.record)
      else holds.push(parsed)
    }
    return { success: true, projectId, records, holds }
  } catch {
    return {
      success: false,
      reason: "load_error",
      error: LOAD_ERROR,
    }
  }
}

export async function getProjectArchivedBuildertrendChangeOrder(
  projectId: string,
  archiveId: string
): Promise<ArchivedBuildertrendChangeOrder | null> {
  if (!archiveId || archiveId.length > 300) return null
  const workspace = await getProjectArchivedBuildertrendChangeOrders(projectId)
  if (!workspace.success) return null
  return workspace.records.find((record) => record.id === archiveId) ?? null
}
