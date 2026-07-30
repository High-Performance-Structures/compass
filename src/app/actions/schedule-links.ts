"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projects,
  scheduleTaskLinks,
  scheduleTasks,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  isScheduleLinkType,
  safeScheduleLinkHref,
  type ScheduleLinkType,
} from "@/lib/schedule/links"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ScheduleTaskLink = {
  readonly id: string
  readonly scheduleTaskId: string
  readonly resourceType: ScheduleLinkType
  readonly label: string
  readonly href: string
  readonly createdAt: string
}

type ScheduleLinkResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function revalidateSchedule(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard/schedule")
}

export async function getScheduleTaskLinks(
  taskId: string
): Promise<readonly ScheduleTaskLink[]> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  if (!isInternalStaffRole(user.role)) return []
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const task = await db
    .select({ projectId: scheduleTasks.projectId })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.id, taskId))
    .get()
  if (!task) return []
  await assertProjectAccess(db, user, task.projectId)

  const rows = await db
    .select({
      id: scheduleTaskLinks.id,
      scheduleTaskId: scheduleTaskLinks.scheduleTaskId,
      resourceType: scheduleTaskLinks.resourceType,
      label: scheduleTaskLinks.label,
      href: scheduleTaskLinks.href,
      createdAt: scheduleTaskLinks.createdAt,
    })
    .from(scheduleTaskLinks)
    .where(eq(scheduleTaskLinks.scheduleTaskId, taskId))
    .orderBy(asc(scheduleTaskLinks.resourceType), asc(scheduleTaskLinks.label))

  const links: ScheduleTaskLink[] = []
  for (const row of rows) {
    if (!isScheduleLinkType(row.resourceType)) continue
    links.push({
      ...row,
      resourceType: row.resourceType,
    })
  }
  return links
}

export async function createScheduleTaskLink(input: {
  readonly taskId: string
  readonly resourceType: string
  readonly label: string
  readonly href: string
}): Promise<ScheduleLinkResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only internal staff can manage links." }
    }
    const organizationId = requireOrg(user)
    if (!isScheduleLinkType(input.resourceType)) {
      return { success: false, error: "Choose a supported link type." }
    }
    const label = input.label.trim()
    if (label.length < 2 || label.length > 160) {
      return { success: false, error: "Enter a label between 2 and 160 characters." }
    }
    const href = safeScheduleLinkHref(input.href)
    if (!href) {
      return {
        success: false,
        error: "Use a Compass dashboard link or a secure https:// link.",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(scheduleTasks.id, input.taskId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()
    if (!task) {
      return { success: false, error: "Schedule item not found." }
    }

    const now = new Date().toISOString()
    const linkId = crypto.randomUUID()
    await db.insert(scheduleTaskLinks).values({
      id: linkId,
      scheduleTaskId: task.id,
      projectId: task.projectId,
      resourceType: input.resourceType,
      resourceId: null,
      label,
      href,
      createdBy: user.id,
      createdAt: now,
    })
    await recordActivityEvent({
      db,
      organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.link_created",
      entityType: "schedule_item_link",
      entityId: linkId,
      summary: `Linked ${input.resourceType} “${label}” to “${task.title}”.`,
    })
    revalidateSchedule(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to create schedule link", error)
    return { success: false, error: "Unable to add the link." }
  }
}

export async function deleteScheduleTaskLink(
  linkId: string
): Promise<ScheduleLinkResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only internal staff can manage links." }
    }
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const link = await db
      .select({
        id: scheduleTaskLinks.id,
        projectId: scheduleTaskLinks.projectId,
        label: scheduleTaskLinks.label,
      })
      .from(scheduleTaskLinks)
      .innerJoin(projects, eq(projects.id, scheduleTaskLinks.projectId))
      .where(
        and(
          eq(scheduleTaskLinks.id, linkId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()
    if (!link) return { success: false, error: "Link not found." }

    await db
      .delete(scheduleTaskLinks)
      .where(
        and(
          eq(scheduleTaskLinks.id, link.id),
          eq(scheduleTaskLinks.projectId, link.projectId)
        )
      )
    await recordActivityEvent({
      db,
      organizationId,
      projectId: link.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.link_deleted",
      entityType: "schedule_item_link",
      entityId: link.id,
      summary: `Removed schedule link “${link.label}”.`,
    })
    revalidateSchedule(link.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to delete schedule link", error)
    return { success: false, error: "Unable to remove the link." }
  }
}
