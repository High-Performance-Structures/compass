/**
 * The schedule.assigned notice for every person on a published schedule
 * item. All assignees are equal, so each linked account gets the same
 * notice; the publish flow passes only the people added since the last
 * publication so nobody is told twice.
 */
import { and, eq } from "drizzle-orm"

import { projectMembers, users } from "@/db/schema"
import { recordActivityEvent, type ActivityActor } from "@/lib/activity-log"
import { createNotificationEvent } from "@/lib/notifications/events"
import { isPublishedScheduleAssignmentVisible } from "@/lib/schedule/confirmation"
import type { Db } from "@/lib/server/action-context"

/** Where an assignee answers or opens the item: the portal for owners and vendors. */
export function scheduleConfirmationHref(
  projectId: string,
  taskId: string,
  projectRole: string | null
): string {
  if (projectRole === "client" || projectRole === "owner") {
    return `/preview/projects/${projectId}/owner/schedule`
  }
  if (projectRole === "subcontractor" || projectRole === "supplier") {
    return `/preview/projects/${projectId}/sub-vendor/schedule`
  }
  return `/dashboard/projects/${projectId}/schedule?view=list&item=${taskId}`
}

/** The accounts a publication assigned: its list, or the single account older snapshots kept. */
export function publishedAssigneeUserIds(task: {
  readonly assignedUserId: string | null
  readonly assigneeUserIds: readonly string[]
}): readonly string[] {
  if (task.assigneeUserIds.length > 0) return task.assigneeUserIds
  return task.assignedUserId ? [task.assignedUserId] : []
}

type NoticeInput = {
  readonly db: Db
  readonly organizationId: string
  readonly actor: ActivityActor & { readonly id: string }
  readonly task: { readonly id: string; readonly projectId: string; readonly title: string }
  readonly published: { readonly ownerVisible?: boolean; readonly subVendorVisible?: boolean }
  readonly recipientUserIds: readonly string[]
}

/**
 * Sends schedule.assigned to each recipient who is active and can see the
 * published item, once per account, then logs one Activity entry. Returns
 * the first reason a recipient was skipped when nobody could be told.
 */
export async function notifyScheduleAssignees(
  input: NoticeInput
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const { db, task } = input
  let firstError: string | null = null
  let notified = 0
  for (const userId of new Set(input.recipientUserIds)) {
    const recipient = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .get()
    if (!recipient) {
      firstError ??= "The assigned Compass user is inactive."
      continue
    }
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, task.projectId), eq(projectMembers.userId, recipient.id)))
      .get()
    const visible = isPublishedScheduleAssignmentVisible({
      currentAssignedUserId: recipient.id,
      publishedAssignedUserId: recipient.id,
      projectRole: membership?.role ?? null,
      ownerVisible: input.published.ownerVisible,
      subVendorVisible: input.published.subVendorVisible,
    })
    if (!visible) {
      firstError ??= "The published item is not visible to the assigned user."
      continue
    }
    await createNotificationEvent({
      organizationId: input.organizationId,
      projectId: task.projectId,
      eventType: "schedule.assigned",
      sourceType: "schedule_item",
      sourceId: task.id,
      title: `Schedule item assigned: ${task.title}`,
      body: `${input.actor.displayName ?? input.actor.email} assigned this to you.`,
      href: scheduleConfirmationHref(task.projectId, task.id, membership?.role ?? null),
      priority: "normal",
      audience: "assignee",
      createdBy: input.actor.id,
      recipients: [{ userId: recipient.id, email: recipient.email }],
      delivery: { inApp: true, email: true, push: true },
    })
    notified += 1
  }
  if (notified === 0) {
    return { success: false, error: firstError ?? "Publish this assignment before sending its notification." }
  }
  await recordActivityEvent({
    db,
    organizationId: input.organizationId,
    projectId: task.projectId,
    actor: input.actor,
    category: "schedule",
    action: "schedule.assignment_notified",
    entityType: "schedule_item",
    entityId: task.id,
    summary:
      notified === 1
        ? `Sent the published assignment for “${task.title}”.`
        : `Sent the published assignment for “${task.title}” to ${notified} assignees.`,
    ...(notified > 1 ? { metadata: { recipientCount: notified } } : {}),
  })
  return { success: true }
}
