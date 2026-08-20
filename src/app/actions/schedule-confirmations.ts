"use server"

import { and, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectMembers,
  projects,
  schedulePublications,
  scheduleTasks,
  users,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { createNotificationEvent } from "@/lib/notifications/events"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import { isPublishedScheduleAssignmentVisible } from "@/lib/schedule/confirmation"
import {
  validateScheduleChangeProposal,
  type ScheduleChangeProposalInput,
} from "@/lib/schedule/change-proposal"
import { parsePublishedScheduleSnapshot } from "@/lib/schedule/publications"
import { isInternalStaffRole } from "@/lib/user-roles"

type ConfirmationResponse = "confirmed" | "declined"

type ScheduleConfirmationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type ScheduleTaskChangeProposal = {
  readonly startDate: string
  readonly workdays: number
  readonly note: string | null
  readonly submittedAt: string
}

async function notifyInternalScheduleResponse(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
  readonly taskId: string
  readonly taskTitle: string
  readonly actorId: string
  readonly actorName: string
  readonly response: "confirmed" | "declined" | "proposed"
  readonly proposal?: ScheduleTaskChangeProposal
}): Promise<void> {
  const members = await input.db
    .select({
      id: users.id,
      email: users.email,
      googleEmail: users.googleEmail,
      role: users.role,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(users.isActive, true)
      )
    )
  const recipients = members
    .filter(
      (member) =>
        member.id !== input.actorId && isInternalStaffRole(member.role)
    )
    .map((member) => ({
      userId: member.id,
      email: member.googleEmail?.trim() || member.email,
    }))
  if (recipients.length === 0) return

  const responseText =
    input.response === "confirmed"
      ? "approved the scheduled date"
      : input.response === "declined"
        ? "declined the scheduled date"
        : `suggested ${input.proposal?.startDate ?? "a new date"} for ${
            input.proposal?.workdays ?? "a different number of"
          } workdays`
  await createNotificationEvent({
    organizationId: input.organizationId,
    projectId: input.projectId,
    eventType: `schedule.${input.response}`,
    sourceType: "schedule_item",
    sourceId: input.taskId,
    title: `Schedule response: ${input.taskTitle}`,
    body: `${input.actorName} ${responseText}.`,
    href: `/dashboard/projects/${input.projectId}/schedule?view=list&item=${input.taskId}`,
    priority: input.response === "proposed" ? "high" : "normal",
    audience: "internal",
    createdBy: input.actorId,
    recipients,
    delivery: {
      inApp: true,
      email: true,
      push: true,
    },
  })
}

function confirmationHref(
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

function revalidateConfirmationPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath(`/preview/projects/${projectId}/owner/schedule`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/schedule`)
}

export async function sendPublishedScheduleAssignment(
  taskId: string
): Promise<ScheduleConfirmationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        assignedUserId: scheduleTasks.assignedUserId,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(scheduleTasks.id, taskId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()
    if (!task?.assignedUserId) {
      return {
        success: false,
        error: "The assignment is not linked to an active Compass user.",
      }
    }

    const publication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, task.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedTask = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)?.tasks.find(
          (item) => item.id === task.id
        )
      : null
    if (!publishedTask || publishedTask.assignedUserId !== task.assignedUserId) {
      return {
        success: false,
        error: "Publish this assignment before sending its notification.",
      }
    }

    const recipient = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, task.assignedUserId), eq(users.isActive, true)))
      .get()
    if (!recipient) {
      return { success: false, error: "The assigned Compass user is inactive." }
    }
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, task.projectId),
          eq(projectMembers.userId, recipient.id)
        )
      )
      .get()
    if (!isPublishedScheduleAssignmentVisible({
      currentAssignedUserId: task.assignedUserId,
      publishedAssignedUserId: publishedTask.assignedUserId,
      projectRole: membership?.role ?? null,
      ownerVisible: publishedTask.ownerVisible,
      subVendorVisible: publishedTask.subVendorVisible,
    })) {
      return {
        success: false,
        error: "The published item is not visible to the assigned user.",
      }
    }

    await createNotificationEvent({
      organizationId,
      projectId: task.projectId,
      eventType: "schedule.assigned",
      sourceType: "schedule_item",
      sourceId: task.id,
      title: `Schedule item assigned: ${task.title}`,
      body: `${user.displayName ?? user.email} assigned this to you.`,
      href: confirmationHref(
        task.projectId,
        task.id,
        membership?.role ?? null
      ),
      priority: "normal",
      audience: "assignee",
      createdBy: user.id,
      recipients: [{ userId: recipient.id, email: recipient.email }],
      delivery: {
        inApp: true,
        email: true,
        push: true,
      },
    })
    await recordActivityEvent({
      db,
      organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.assignment_notified",
      entityType: "schedule_item",
      entityId: task.id,
      summary: `Sent the published assignment for “${task.title}”.`,
    })
    return { success: true }
  } catch (error) {
    console.error("Unable to send published schedule assignment", error)
    return { success: false, error: "Unable to send the assignment notification." }
  }
}

export async function sendScheduleTaskReminder(
  taskId: string
): Promise<ScheduleConfirmationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        assignedUserId: scheduleTasks.assignedUserId,
        confirmationRequired: scheduleTasks.confirmationRequired,
        confirmationStatus: scheduleTasks.confirmationStatus,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(scheduleTasks.id, taskId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()

    if (!task) {
      return { success: false, error: "Schedule item not found" }
    }
    if (!task.confirmationRequired) {
      return {
        success: false,
        error: "Confirmation is not required for this schedule item.",
      }
    }
    if (!task.assignedUserId) {
      return {
        success: false,
        error:
          "The responsible contact needs an active Compass account before reminders can be sent.",
      }
    }
    if (task.confirmationStatus === "confirmed") {
      return { success: false, error: "This assignment is already confirmed." }
    }
    const publication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, task.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedTask = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)?.tasks.find(
          (item) => item.id === task.id
        )
      : null
    if (
      !publishedTask ||
      publishedTask.assignedUserId !== task.assignedUserId ||
      publishedTask.confirmationRequired !== true
    ) {
      return {
        success: false,
        error:
          "Publish this schedule change before sending a confirmation reminder.",
      }
    }

    const recipient = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.id, task.assignedUserId), eq(users.isActive, true)))
      .get()
    if (!recipient) {
      return { success: false, error: "The assigned Compass user is inactive." }
    }
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, task.projectId),
          eq(projectMembers.userId, recipient.id)
        )
      )
      .get()
    if (!isPublishedScheduleAssignmentVisible({
      currentAssignedUserId: task.assignedUserId,
      publishedAssignedUserId: publishedTask.assignedUserId,
      projectRole: membership?.role ?? null,
      ownerVisible: publishedTask.ownerVisible,
      subVendorVisible: publishedTask.subVendorVisible,
      confirmationRequired: true,
      publishedConfirmationRequired: publishedTask.confirmationRequired,
    })) {
      return {
        success: false,
        error:
          "Make this item visible to the assigned project audience before sending a reminder.",
      }
    }

    await createNotificationEvent({
      organizationId,
      projectId: task.projectId,
      eventType: "schedule.confirmation_reminder",
      sourceType: "schedule_item",
      sourceId: task.id,
      title: `Please confirm: ${task.title}`,
      body: `${user.displayName ?? user.email} is waiting for your schedule commitment response.`,
      href: confirmationHref(
        task.projectId,
        task.id,
        membership?.role ?? null
      ),
      priority: "high",
      audience: "assignee",
      createdBy: user.id,
      recipients: [{ userId: recipient.id, email: recipient.email }],
      delivery: {
        inApp: true,
        email: true,
        push: true,
      },
    })

    const now = new Date().toISOString()
    await db
      .update(scheduleTasks)
      .set({ reminderSentAt: now, updatedAt: now })
      .where(
        and(
          eq(scheduleTasks.id, task.id),
          eq(scheduleTasks.projectId, task.projectId)
        )
      )
    await recordActivityEvent({
      db,
      organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.confirmation_reminded",
      entityType: "schedule_item",
      entityId: task.id,
      summary: `Sent a confirmation reminder for “${task.title}”.`,
    })
    revalidateConfirmationPaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to send schedule confirmation reminder", error)
    return { success: false, error: "Unable to send the reminder." }
  }
}

export async function respondToScheduleTaskConfirmation(
  taskId: string,
  response: ConfirmationResponse
): Promise<ScheduleConfirmationResult> {
  try {
    if (response !== "confirmed" && response !== "declined") {
      return { success: false, error: "Unsupported confirmation response." }
    }
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .get()
    if (!task) {
      return { success: false, error: "Schedule item not found." }
    }

    const project = await assertProjectAccess(db, user, task.projectId)
    if (!project.organizationId || task.assignedUserId !== user.id) {
      return { success: false, error: "This confirmation is not assigned to you." }
    }
    if (!task.confirmationRequired) {
      return { success: false, error: "Confirmation is no longer required." }
    }
    const publication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, task.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedTask = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)?.tasks.find(
          (item) => item.id === task.id
        )
      : null
    if (
      !publishedTask ||
      publishedTask.assignedUserId !== user.id ||
      !publishedTask.confirmationRequired
    ) {
      return {
        success: false,
        error: "This confirmation request has not been published.",
      }
    }
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, task.projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .get()
    if (
      membership?.role !== "subcontractor" &&
      membership?.role !== "supplier"
    ) {
      return {
        success: false,
        error: "Only the assigned subcontractor or supplier can respond.",
      }
    }
    if (
      !publishedTask.subVendorVisible ||
      task.startDate !== publishedTask.startDate ||
      task.workdays !== publishedTask.workdays
    ) {
      return {
        success: false,
        error: "The project team must publish the current dates before you respond.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(scheduleTasks)
      .set({
        confirmationStatus: response,
        confirmationRespondedAt: now,
        proposedStartDate: null,
        proposedWorkdays: null,
        proposalNote: null,
        proposalSubmittedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduleTasks.id, task.id),
          eq(scheduleTasks.assignedUserId, user.id)
        )
      )
    await recordActivityEvent({
      db,
      organizationId: project.organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: `schedule.assignment_${response}`,
      entityType: "schedule_item",
      entityId: task.id,
      summary:
        response === "confirmed"
          ? `Confirmed the assignment for “${task.title}”.`
          : `Could not confirm the assignment for “${task.title}”.`,
    })
    await notifyInternalScheduleResponse({
      db,
      organizationId: project.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      response,
    })
    revalidateConfirmationPaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to respond to schedule confirmation", error)
    return { success: false, error: "Unable to save your response." }
  }
}

export async function proposeScheduleTaskChange(
  taskId: string,
  input: ScheduleChangeProposalInput
): Promise<ScheduleConfirmationResult> {
  try {
    const validation = validateScheduleChangeProposal(input)
    if (!validation.success) return validation
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .get()
    if (!task) return { success: false, error: "Schedule item not found." }

    const project = await assertProjectAccess(db, user, task.projectId)
    if (!project.organizationId || task.assignedUserId !== user.id) {
      return { success: false, error: "This schedule item is not assigned to you." }
    }
    if (!task.confirmationRequired) {
      return { success: false, error: "A response is no longer required." }
    }
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, task.projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .get()
    if (
      membership?.role !== "subcontractor" &&
      membership?.role !== "supplier"
    ) {
      return {
        success: false,
        error: "Only the assigned subcontractor or supplier can suggest dates.",
      }
    }
    const publication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, task.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedTask = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)?.tasks.find(
          (item) => item.id === task.id
        )
      : null
    if (
      !publishedTask ||
      publishedTask.assignedUserId !== user.id ||
      !publishedTask.confirmationRequired ||
      !publishedTask.subVendorVisible ||
      task.startDate !== publishedTask.startDate ||
      task.workdays !== publishedTask.workdays
    ) {
      return {
        success: false,
        error: "The project team must publish the current assignment before you suggest dates.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(scheduleTasks)
      .set({
        confirmationStatus: "proposed",
        confirmationRespondedAt: now,
        proposedStartDate: validation.proposal.startDate,
        proposedWorkdays: validation.proposal.workdays,
        proposalNote: validation.proposal.note,
        proposalSubmittedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduleTasks.id, task.id),
          eq(scheduleTasks.assignedUserId, user.id)
        )
      )
    const proposal: ScheduleTaskChangeProposal = {
      startDate: validation.proposal.startDate,
      workdays: validation.proposal.workdays,
      note: validation.proposal.note,
      submittedAt: now,
    }
    await recordActivityEvent({
      db,
      organizationId: project.organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.assignment_change_proposed",
      entityType: "schedule_item",
      entityId: task.id,
      summary: `Suggested ${proposal.startDate} for ${proposal.workdays} workdays for “${task.title}”.`,
      metadata: {
        proposedStartDate: proposal.startDate,
        proposedWorkdays: proposal.workdays,
        note: proposal.note,
      },
    })
    await notifyInternalScheduleResponse({
      db,
      organizationId: project.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      actorId: user.id,
      actorName: user.displayName ?? user.email,
      response: "proposed",
      proposal,
    })
    revalidateConfirmationPaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to propose a schedule change", error)
    return { success: false, error: "Unable to submit the proposed schedule change." }
  }
}

export async function getScheduleTaskChangeProposal(
  taskId: string
): Promise<ScheduleTaskChangeProposal | null> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "update")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const task = await db
    .select({
      projectId: scheduleTasks.projectId,
      proposedStartDate: scheduleTasks.proposedStartDate,
      proposedWorkdays: scheduleTasks.proposedWorkdays,
      proposalNote: scheduleTasks.proposalNote,
      proposalSubmittedAt: scheduleTasks.proposalSubmittedAt,
    })
    .from(scheduleTasks)
    .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
    .where(
      and(
        eq(scheduleTasks.id, taskId),
        eq(projects.organizationId, organizationId)
      )
    )
    .get()
  if (
    !task?.proposedStartDate ||
    task.proposedWorkdays === null ||
    !task.proposalSubmittedAt
  ) {
    return null
  }
  return {
    startDate: task.proposedStartDate,
    workdays: task.proposedWorkdays,
    note: task.proposalNote,
    submittedAt: task.proposalSubmittedAt,
  }
}

export async function rejectScheduleTaskChangeProposal(
  taskId: string
): Promise<ScheduleConfirmationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const task = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        proposedStartDate: scheduleTasks.proposedStartDate,
      })
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(scheduleTasks.id, taskId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()
    if (!task) return { success: false, error: "Schedule item not found." }
    if (!task.proposedStartDate) {
      return { success: false, error: "There is no pending date proposal." }
    }
    const now = new Date().toISOString()
    await db
      .update(scheduleTasks)
      .set({
        confirmationStatus: "pending",
        confirmationRespondedAt: null,
        proposedStartDate: null,
        proposedWorkdays: null,
        proposalNote: null,
        proposalSubmittedAt: null,
        updatedAt: now,
      })
      .where(eq(scheduleTasks.id, task.id))
    await recordActivityEvent({
      db,
      organizationId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.assignment_change_rejected",
      entityType: "schedule_item",
      entityId: task.id,
      summary: `Declined the proposed date change for “${task.title}”.`,
    })
    revalidateConfirmationPaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to reject schedule change proposal", error)
    return { success: false, error: "Unable to decline the proposed change." }
  }
}
