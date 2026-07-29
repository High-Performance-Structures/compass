"use server"

import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { activityEvents, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
} from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ActivityEventView = {
  readonly id: string
  readonly projectId: string | null
  readonly projectName: string | null
  readonly actorUserId: string | null
  readonly actorName: string
  readonly actorRole: string
  readonly category: ActivityCategory
  readonly action: string
  readonly entityType: string
  readonly entityId: string | null
  readonly summary: string
  readonly createdAt: string
}

export type ActivityFilters = {
  readonly category?: string
  readonly projectId?: string
}

export async function getActivityEvents(
  filters: ActivityFilters = {}
): Promise<readonly ActivityEventView[]> {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Only internal staff can view organization activity.")
  }

  const organizationId = requireOrg(user)
  const category = ACTIVITY_CATEGORIES.find(
    (candidate) => candidate === filters.category
  )
  const projectId = filters.projectId?.trim()
  const conditions = [eq(activityEvents.organizationId, organizationId)]
  if (category) conditions.push(eq(activityEvents.category, category))
  if (projectId) conditions.push(eq(activityEvents.projectId, projectId))

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const rows = await db
    .select({
      id: activityEvents.id,
      projectId: activityEvents.projectId,
      projectName: projects.name,
      actorUserId: activityEvents.actorUserId,
      actorName: activityEvents.actorName,
      actorRole: activityEvents.actorRole,
      category: activityEvents.category,
      action: activityEvents.action,
      entityType: activityEvents.entityType,
      entityId: activityEvents.entityId,
      summary: activityEvents.summary,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(projects, eq(activityEvents.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt))
    .limit(250)

  return rows.flatMap((row) => {
    const validCategory = ACTIVITY_CATEGORIES.find(
      (candidate) => candidate === row.category
    )
    if (!validCategory) return []
    return [{ ...row, category: validCategory }]
  })
}
