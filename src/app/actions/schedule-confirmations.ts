"use server"

import { and, desc, eq, notInArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectMembers,
  projectAccessInvitations,
  organizationMembers,
  projectContacts,
  projects,
  schedulePublications,
  scheduleTasks,
  users,
} from "@/db/schema"
import {
  projectSourceRecordParticipants,
  scheduleTaskAssignees,
} from "@/db/schema-participants"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { createNotificationEvent } from "@/lib/notifications/events"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import {
  canParticipantPerform,
  PARTICIPANT_CAPABILITIES,
} from "@/lib/participant-access"
import { assertProjectAccess } from "@/lib/project-access"
import { isPublishedScheduleAssignmentVisible } from "@/lib/schedule/confirmation"
import {
  validateScheduleChangeProposal,
  type ScheduleChangeProposalInput,
} from "@/lib/schedule/change-proposal"
import { parsePublishedScheduleSnapshot } from "@/lib/schedule/publications"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  isPublishedScheduleVisibleToAssignee,
  sameScheduleAssigneeSet,
  scheduleAssigneeResponseState,
  type ScheduleAssigneeAudience,
  type ScheduleAssigneeProposalInput,
  type ScheduleAssigneeResponse,
} from "@/lib/schedule/multi-assignee"

type ConfirmationResponse = "confirmed" | "declined"

type ScheduleResponseNotificationProposal = {
  readonly startDate: string | null
  readonly workdays: number | null
  readonly note: string | null
  readonly submittedAt: string
}

type ScheduleConfirmationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

async function hasNormalizedScheduleAssignees(
  db: ReturnType<typeof getDb>,
  taskId: string,
): Promise<boolean> {
  const assignment = await db
    .select({ id: scheduleTaskAssignees.id })
    .from(scheduleTaskAssignees)
    .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return assignment !== null
}

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
  readonly note?: string | null
  readonly proposal?: ScheduleResponseNotificationProposal
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
    body: `${input.actorName} ${responseText}.${input.note?.trim() ? ` ${input.note.trim()}` : ""}`,
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
        confirmationRequired: scheduleTasks.confirmationRequired,
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

    const publication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, task.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedSnapshot = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)
      : null
    const publishedTask = publishedSnapshot?.tasks.find(
      (item) => item.id === task.id
    ) ?? null
    const normalizedAssignments = await db
      .select({
        participantId: scheduleTaskAssignees.participantId,
        assignedUserId: scheduleTaskAssignees.assignedUserId,
        projectContactId: scheduleTaskAssignees.projectContactId,
      })
      .from(scheduleTaskAssignees)
      .where(eq(scheduleTaskAssignees.scheduleTaskId, task.id))
    if (normalizedAssignments.length > 0) {
      if (
        !publishedTask ||
        !sameScheduleAssigneeSet(
          normalizedAssignments.map((assignment) => assignment.participantId),
          publishedTask.assigneeParticipantIds,
        )
      ) {
        return {
          success: false,
          error: "Publish the current assignee set before sending notifications.",
        }
      }
      const hasExplicitPartnerSelection =
        publishedSnapshot?.tasks.some((item) => item.subVendorVisible === true) ?? false
      const notifiedUserIds = new Set<string>()
      for (const assignment of normalizedAssignments) {
        const target = await resolveReviewedAssignmentTarget(
          db,
          organizationId,
          task.projectId,
          { participantId: assignment.participantId },
        )
        if (
          !target ||
          target.assignedUserId !== assignment.assignedUserId ||
          target.projectContactId !== assignment.projectContactId ||
          !isPublishedScheduleVisibleToAssignee({
            audience: target.audience,
            ownerVisible: publishedTask.ownerVisible,
            subVendorVisible: publishedTask.subVendorVisible,
            hasExplicitPartnerSelection,
          })
        ) {
          continue
        }
        let recipientUserId = assignment.assignedUserId
        if (!recipientUserId && assignment.projectContactId) {
          const invitation = await db
            .select({ acceptedBy: projectAccessInvitations.acceptedBy })
            .from(projectAccessInvitations)
            .where(
              and(
                eq(projectAccessInvitations.projectId, task.projectId),
                eq(projectAccessInvitations.projectContactId, assignment.projectContactId),
                eq(projectAccessInvitations.status, "accepted"),
              ),
            )
            .orderBy(desc(projectAccessInvitations.acceptedAt))
            .limit(1)
            .then((rows) => rows[0]?.acceptedBy ?? null)
          recipientUserId = invitation
        }
        if (!recipientUserId || notifiedUserIds.has(recipientUserId)) continue
        const recipient = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(eq(users.id, recipientUserId), eq(users.isActive, true)))
          .get()
        if (!recipient) continue
        const membership = await db
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, task.projectId),
              eq(projectMembers.userId, recipient.id),
            ),
          )
          .get()
        await createNotificationEvent({
          organizationId,
          projectId: task.projectId,
          eventType: task.confirmationRequired
            ? "schedule.confirmation_requested"
            : "schedule.assigned",
          sourceType: "schedule_item",
          sourceId: task.id,
          title: task.confirmationRequired
            ? `Schedule confirmation requested: ${task.title}`
            : `Schedule item assigned: ${task.title}`,
          body: `${user.displayName ?? user.email} assigned this to you.`,
          href: confirmationHref(task.projectId, task.id, membership?.role ?? null),
          priority: task.confirmationRequired ? "high" : "normal",
          audience: "assignee",
          createdBy: user.id,
          recipients: [{ userId: recipient.id, email: recipient.email }],
          delivery: { inApp: true, email: true, push: true },
        })
        notifiedUserIds.add(recipient.id)
      }
      if (notifiedUserIds.size > 0) {
        await recordActivityEvent({
          db,
          organizationId,
          projectId: task.projectId,
          actor: user,
          category: "schedule",
          action: "schedule.assignment_notified",
          entityType: "schedule_item",
          entityId: task.id,
          summary: `Sent the published assignment for “${task.title}” to ${notifiedUserIds.size} assignee${notifiedUserIds.size === 1 ? "" : "s"}.`,
          metadata: { recipientCount: notifiedUserIds.size },
        })
      }
      return { success: true }
    }
    if (!task.assignedUserId) {
      return {
        success: false,
        error: "The assignment is not linked to an active Compass user.",
      }
    }
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
  response: ConfirmationResponse,
  note = ""
): Promise<ScheduleConfirmationResult> {
  try {
    if (response !== "confirmed" && response !== "declined") {
      return { success: false, error: "Unsupported confirmation response." }
    }
    if (typeof note !== "string" || note.length > 1000) {
      return { success: false, error: "Notes must be 1,000 characters or fewer." }
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
    if (await hasNormalizedScheduleAssignees(db, task.id)) {
      return {
        success: false,
        error: "Respond to your individual schedule assignment.",
      }
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
      membership?.role !== "supplier" &&
      membership?.role !== "client" &&
      membership?.role !== "owner"
    ) {
      return {
        success: false,
        error: "Only the assigned owner or vendor can respond.",
      }
    }
    if (
      !isPublishedScheduleAssignmentVisible({
        currentAssignedUserId: task.assignedUserId,
        publishedAssignedUserId: publishedTask.assignedUserId,
        projectRole: membership.role,
        ownerVisible: publishedTask.ownerVisible,
        subVendorVisible: publishedTask.subVendorVisible,
      }) ||
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
        proposalNote: note.trim() || null,
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
      metadata: { note: note.trim() || null },
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
      note,
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
    if (await hasNormalizedScheduleAssignees(db, task.id)) {
      return {
        success: false,
        error: "Respond to your individual schedule assignment.",
      }
    }

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
      membership?.role !== "supplier" &&
      membership?.role !== "client" &&
      membership?.role !== "owner"
    ) {
      return {
        success: false,
        error: "Only the assigned owner or vendor can suggest dates.",
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
      !isPublishedScheduleAssignmentVisible({
        currentAssignedUserId: task.assignedUserId,
        publishedAssignedUserId: publishedTask.assignedUserId,
        projectRole: membership.role,
        ownerVisible: publishedTask.ownerVisible,
        subVendorVisible: publishedTask.subVendorVisible,
      }) ||
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

export type ScheduleTaskAssigneeInput = {
  readonly participantId?: string
  readonly assignedUserId?: string | null
  readonly projectContactId?: string | null
  readonly participantRole?: string
}

export type ScheduleTaskAssigneeView = {
  readonly id: string
  readonly participantId: string
  readonly assignedUserId: string | null
  readonly projectContactId: string | null
  readonly participantRole: string
  readonly responseStatus: string
  readonly dateResponseStatus: string
  readonly durationResponseStatus: string
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly proposedEndDate: string | null
  readonly responseMessage: string | null
  readonly respondedAt: string | null
  readonly displayName: string | null
  readonly sourceName: string | null
}

type AssignmentTarget = {
  readonly participantId: string
  readonly assignedUserId: string | null
  readonly projectContactId: string | null
  readonly audience: ScheduleAssigneeAudience
}

function assignmentAudienceForProjectRole(
  role: string,
): ScheduleAssigneeAudience {
  if (role === "client" || role === "owner") return "owner"
  if (role === "subcontractor" || role === "supplier") return "sub_vendor"
  return "internal"
}

function assignmentAudienceForContactType(
  contactType: string,
): ScheduleAssigneeAudience | null {
  if (contactType === "owner") return "owner"
  if (contactType === "supplier" || contactType === "subcontractor") {
    return "sub_vendor"
  }
  if (contactType === "internal") return "internal"
  return null
}

async function resolveReviewedAssignmentTarget(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectId: string,
  input: ScheduleTaskAssigneeInput,
): Promise<AssignmentTarget | null> {
  const identityFilter = input.participantId
    ? eq(projectSourceRecordParticipants.id, input.participantId)
    : input.assignedUserId
      ? eq(projectSourceRecordParticipants.userId, input.assignedUserId)
      : input.projectContactId
        ? eq(projectSourceRecordParticipants.projectContactId, input.projectContactId)
        : undefined
  if (!identityFilter) return null
  const participant = await db
    .select({
      id: projectSourceRecordParticipants.id,
      projectId: projectSourceRecordParticipants.projectId,
      organizationId: projectSourceRecordParticipants.organizationId,
      userId: projectSourceRecordParticipants.userId,
      projectContactId: projectSourceRecordParticipants.projectContactId,
      reviewStatus: projectSourceRecordParticipants.reviewStatus,
      identityStatus: projectSourceRecordParticipants.identityStatus,
      membershipStatus: projectSourceRecordParticipants.membershipStatus,
      active: projectSourceRecordParticipants.active,
      capabilitiesJson: projectSourceRecordParticipants.capabilitiesJson,
    })
    .from(projectSourceRecordParticipants)
    .where(
      and(
        eq(projectSourceRecordParticipants.organizationId, organizationId),
        eq(projectSourceRecordParticipants.projectId, projectId),
        identityFilter,
      ),
    )
    .get()
  if (
    !participant ||
    participant.organizationId !== organizationId ||
    participant.projectId !== projectId ||
    !participant.active ||
    participant.reviewStatus !== "reviewed" ||
    participant.identityStatus !== "matched" ||
    participant.membershipStatus !== "active" ||
    (participant.userId === null && participant.projectContactId === null) ||
    !canParticipantPerform(participant, PARTICIPANT_CAPABILITIES.scheduleRespond)
  ) {
    return null
  }
  if (
    (input.assignedUserId !== undefined &&
      input.assignedUserId !== participant.userId) ||
    (input.projectContactId !== undefined &&
      input.projectContactId !== participant.projectContactId)
  ) {
    return null
  }
  let audience: ScheduleAssigneeAudience | null = null
  if (participant.userId !== null) {
    const member = await db
      .select({ id: users.id, role: projectMembers.role })
      .from(users)
      .innerJoin(
        organizationMembers,
        eq(organizationMembers.userId, users.id),
      )
      .innerJoin(projectMembers, eq(projectMembers.userId, users.id))
      .where(
        and(
          eq(users.id, participant.userId),
          eq(users.isActive, true),
          eq(organizationMembers.organizationId, organizationId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .get()
    if (!member) return null
    audience = assignmentAudienceForProjectRole(member.role)
  }
  if (participant.projectContactId !== null) {
    const contact = await db
      .select({
        id: projectContacts.id,
        contactType: projectContacts.contactType,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, participant.projectContactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true),
        ),
      )
      .get()
    if (!contact) return null
    const contactAudience = assignmentAudienceForContactType(contact.contactType)
    if (contactAudience === null || (audience !== null && audience !== contactAudience)) {
      return null
    }
    audience = contactAudience
  }
  if (audience === null) return null
  return {
    participantId: participant.id,
    assignedUserId: participant.userId,
    projectContactId: participant.projectContactId,
    audience,
  }
}

export async function getScheduleTaskAssignees(
  taskId: string,
): Promise<readonly ScheduleTaskAssigneeView[]> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const task = await db
    .select({ projectId: scheduleTasks.projectId })
    .from(scheduleTasks)
    .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
    .where(
      and(
        eq(scheduleTasks.id, taskId),
        eq(projects.organizationId, organizationId),
      ),
    )
    .get()
  if (!task) throw new Error("Schedule item not found or access denied")
  await assertProjectAccess(db, user, task.projectId)
  const rows = await db
    .select({
      id: scheduleTaskAssignees.id,
      participantId: scheduleTaskAssignees.participantId,
      assignedUserId: scheduleTaskAssignees.assignedUserId,
      projectContactId: scheduleTaskAssignees.projectContactId,
      participantRole: scheduleTaskAssignees.participantRole,
      responseStatus: scheduleTaskAssignees.responseStatus,
      dateResponseStatus: scheduleTaskAssignees.dateResponseStatus,
      durationResponseStatus: scheduleTaskAssignees.durationResponseStatus,
      proposedStartDate: scheduleTaskAssignees.proposedStartDate,
      proposedWorkdays: scheduleTaskAssignees.proposedWorkdays,
      proposedEndDate: scheduleTaskAssignees.proposedEndDate,
      responseMessage: scheduleTaskAssignees.responseMessage,
      respondedAt: scheduleTaskAssignees.respondedAt,
      displayName: projectSourceRecordParticipants.sourceContactName,
      sourceName: projectSourceRecordParticipants.sourceContactName,
    })
    .from(scheduleTaskAssignees)
    .innerJoin(
      projectSourceRecordParticipants,
      eq(
        projectSourceRecordParticipants.id,
        scheduleTaskAssignees.participantId,
      ),
    )
    .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId))
  if (isInternalStaffRole(user.role)) return rows
  const acceptedContacts = await db
    .select({ projectContactId: projectAccessInvitations.projectContactId })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.projectId, task.projectId),
        eq(projectAccessInvitations.acceptedBy, user.id),
        eq(projectAccessInvitations.status, "accepted"),
      ),
    )
  const allowedContactIds = new Set(
    acceptedContacts.flatMap((row) =>
      row.projectContactId ? [row.projectContactId] : [],
    ),
  )
  return rows.filter(
    (row) =>
      row.assignedUserId === user.id ||
      (row.projectContactId !== null && allowedContactIds.has(row.projectContactId)),
  )
}

export async function setScheduleTaskAssignees(
  taskId: string,
  inputs: readonly (ScheduleTaskAssigneeInput | string)[],
): Promise<ScheduleConfirmationResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    if (inputs.length > 50) {
      return {
        success: false,
        error: "A schedule item may have at most 50 assignees.",
      }
    }
    const task = await db
      .select()
      .from(scheduleTasks)
      .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
      .where(
        and(
          eq(scheduleTasks.id, taskId),
          eq(projects.organizationId, organizationId),
        ),
      )
      .get()
    if (!task) return { success: false, error: "Schedule item not found." }
    const targets: AssignmentTarget[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const assignmentInput: ScheduleTaskAssigneeInput =
        typeof input === "string" ? { participantId: input } : input
      const target = await resolveReviewedAssignmentTarget(
        db,
        organizationId,
        task.schedule_tasks.projectId,
        assignmentInput,
      )
      if (!target) {
        return {
          success: false,
          error: "Every assignee must be a reviewed project participant with active access.",
        }
      }
      const key = target.assignedUserId
        ? `user:${target.assignedUserId}`
        : `contact:${target.projectContactId ?? target.participantId}`
      if (seen.has(key)) {
        return { success: false, error: "An assignee may only be selected once." }
      }
      seen.add(key)
      targets.push(target)
    }
    const now = new Date().toISOString()
    const existingRows = await db
      .select()
      .from(scheduleTaskAssignees)
      .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId))
    const existingByParticipant = new Map(
      existingRows.map((row) => [row.participantId, row]),
    )
    const assignmentStatements: BatchItem<"sqlite">[] = []
    for (const [index, target] of targets.entries()) {
      const existing = existingByParticipant.get(target.participantId)
      const participantRole =
        (typeof inputs[index] === "string"
          ? undefined
          : inputs[index]?.participantRole) ?? "assignee"
      if (!existing) {
        assignmentStatements.push(
          db.insert(scheduleTaskAssignees).values({
            id: crypto.randomUUID(),
            scheduleTaskId: taskId,
            participantId: target.participantId,
            assignedUserId: target.assignedUserId,
            projectContactId: target.projectContactId,
            participantRole,
            sourceStartDate: task.schedule_tasks.startDate,
            sourceWorkdays: task.schedule_tasks.workdays,
            sourceEndDate: task.schedule_tasks.endDateCalculated,
            responseStatus: "pending",
            dateResponseStatus: "pending",
            durationResponseStatus: "pending",
            assignedAt: now,
            createdAt: now,
            updatedAt: now,
          }),
        )
        continue
      }

      const sourceChanged =
        existing.sourceStartDate !== task.schedule_tasks.startDate ||
        existing.sourceWorkdays !== task.schedule_tasks.workdays ||
        existing.sourceEndDate !== task.schedule_tasks.endDateCalculated
      const targetChanged =
        existing.assignedUserId !== target.assignedUserId ||
        existing.projectContactId !== target.projectContactId
      assignmentStatements.push(
        db
          .update(scheduleTaskAssignees)
          .set(
            sourceChanged || targetChanged
              ? {
                  assignedUserId: target.assignedUserId,
                  projectContactId: target.projectContactId,
                  participantRole,
                  sourceStartDate: task.schedule_tasks.startDate,
                  sourceWorkdays: task.schedule_tasks.workdays,
                  sourceEndDate: task.schedule_tasks.endDateCalculated,
                  responseStatus: "pending",
                  dateResponseStatus: "pending",
                  durationResponseStatus: "pending",
                  proposedStartDate: null,
                  proposedWorkdays: null,
                  proposedEndDate: null,
                  responseMessage: null,
                  respondedAt: null,
                  respondedByUserId: null,
                  responseSource: null,
                  assignedAt: now,
                  updatedAt: now,
                }
              : {
                  participantRole,
                  updatedAt:
                    participantRole === existing.participantRole
                      ? existing.updatedAt
                      : now,
                },
          )
          .where(eq(scheduleTaskAssignees.id, existing.id)),
      )
    }
    const targetParticipantIds = targets.map((target) => target.participantId)
    const removalStatement = db
      .delete(scheduleTaskAssignees)
      .where(
        targetParticipantIds.length === 0
          ? eq(scheduleTaskAssignees.scheduleTaskId, taskId)
          : and(
              eq(scheduleTaskAssignees.scheduleTaskId, taskId),
              notInArray(
                scheduleTaskAssignees.participantId,
                targetParticipantIds,
              ),
            ),
      )
    // Keep the legacy scalar useful for existing readers only when the child
    // relation has exactly one internal-user target. A multi-target task must
    // not accidentally route a response through the old scalar action.
    await db.batch([
      removalStatement,
      db
        .update(scheduleTasks)
        .set({
          assignedTo: null,
          assignedUserId:
            targets.length === 1 ? targets[0]?.assignedUserId ?? null : null,
          updatedAt: now,
        })
        .where(eq(scheduleTasks.id, taskId)),
      ...assignmentStatements,
    ])
    await recordActivityEvent({
      db,
      organizationId,
      projectId: task.schedule_tasks.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.assignees_updated",
      entityType: "schedule_item",
      entityId: taskId,
      summary: `Updated assignees for “${task.schedule_tasks.title}”.`,
      metadata: { assigneeCount: targets.length },
    })
    revalidateConfirmationPaths(task.schedule_tasks.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to update schedule assignees", error)
    return { success: false, error: "Unable to update schedule assignees." }
  }
}

export async function respondToScheduleTaskAssignee(
  assignmentId: string,
  input: ScheduleAssigneeProposalInput | ScheduleAssigneeResponse,
): Promise<ScheduleConfirmationResult> {
  try {
    const responseInput: ScheduleAssigneeProposalInput =
      typeof input === "string" ? { response: input } : input
    if (
      responseInput.response !== "confirmed" &&
      responseInput.response !== "declined" &&
      responseInput.response !== "proposed"
    ) {
      return { success: false, error: "Unsupported assignee response." }
    }
    const state = scheduleAssigneeResponseState(responseInput)
    if ("error" in state) return { success: false, error: state.error }
    const user = await requireAuth()
    requirePermission(user, "schedule", "read")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const assignment = await db
      .select({
        id: scheduleTaskAssignees.id,
        taskId: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        workdays: scheduleTasks.workdays,
        confirmationRequired: scheduleTasks.confirmationRequired,
        participantId: scheduleTaskAssignees.participantId,
        assignedUserId: scheduleTaskAssignees.assignedUserId,
        projectContactId: scheduleTaskAssignees.projectContactId,
        assignedAt: scheduleTaskAssignees.assignedAt,
      })
      .from(scheduleTaskAssignees)
      .innerJoin(scheduleTasks, eq(scheduleTasks.id, scheduleTaskAssignees.scheduleTaskId))
      .where(eq(scheduleTaskAssignees.id, assignmentId))
      .get()
    if (!assignment) return { success: false, error: "Assignment not found." }
    const project = await assertProjectAccess(db, user, assignment.projectId)
    if (!project.organizationId || !assignment.confirmationRequired) {
      return { success: false, error: "A response is not required for this assignment." }
    }
    const publication = await db
      .select({
        snapshotData: schedulePublications.snapshotData,
        publishedAt: schedulePublications.publishedAt,
      })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, assignment.projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const publishedTask = publication
      ? parsePublishedScheduleSnapshot(publication.snapshotData)?.tasks.find(
          (task) => task.id === assignment.taskId,
        )
      : null
    const currentAssigneeRows = await db
      .select({ participantId: scheduleTaskAssignees.participantId })
      .from(scheduleTaskAssignees)
      .where(eq(scheduleTaskAssignees.scheduleTaskId, assignment.taskId))
    const assigneeSetMatches = sameScheduleAssigneeSet(
      currentAssigneeRows.map((row) => row.participantId),
      publishedTask?.assigneeParticipantIds ?? [],
    )
    if (
      !publishedTask ||
      !publishedTask.confirmationRequired ||
      publishedTask.startDate !== assignment.startDate ||
      publishedTask.workdays !== assignment.workdays ||
      assignment.assignedAt > (publication?.publishedAt ?? "") ||
      !assigneeSetMatches
    ) {
      return {
        success: false,
        error: "The project team must publish the current schedule before you respond.",
      }
    }
    let authorized = assignment.assignedUserId === user.id
    if (!authorized && assignment.projectContactId !== null) {
      const invitation = await db
        .select({ id: projectAccessInvitations.id })
        .from(projectAccessInvitations)
        .where(
          and(
            eq(projectAccessInvitations.projectId, assignment.projectId),
            eq(projectAccessInvitations.projectContactId, assignment.projectContactId),
            eq(projectAccessInvitations.acceptedBy, user.id),
            eq(projectAccessInvitations.status, "accepted"),
          ),
        )
        .get()
      authorized = invitation !== undefined
    }
    if (!authorized) {
      return { success: false, error: "This confirmation is not assigned to you." }
    }
    const participant = await resolveReviewedAssignmentTarget(
      db,
      project.organizationId,
      assignment.projectId,
      { participantId: assignment.participantId },
    )
    if (!participant) return { success: false, error: "This participant is no longer eligible." }
    if (
      participant.assignedUserId !== assignment.assignedUserId ||
      participant.projectContactId !== assignment.projectContactId
    ) {
      return { success: false, error: "This assignment target is no longer valid." }
    }
    if (
      !isPublishedScheduleVisibleToAssignee({
        audience: participant.audience,
        ownerVisible: publishedTask.ownerVisible,
        subVendorVisible: publishedTask.subVendorVisible,
        hasExplicitPartnerSelection:
          parsePublishedScheduleSnapshot(publication?.snapshotData ?? "")?.tasks.some(
            (task) => task.subVendorVisible === true,
          ) ?? false,
      })
    ) {
      return {
        success: false,
        error: "This published schedule item is not visible to your project audience.",
      }
    }
    const now = new Date().toISOString()
    await db
      .update(scheduleTaskAssignees)
      .set({
        responseStatus: state.responseStatus,
        dateResponseStatus: state.dateResponseStatus,
        durationResponseStatus: state.durationResponseStatus,
        proposedStartDate: responseInput.response === "proposed" ? responseInput.proposedStartDate?.trim() || null : null,
        proposedWorkdays: responseInput.response === "proposed" ? responseInput.proposedWorkdays ?? null : null,
        responseMessage: responseInput.message?.trim() || null,
        respondedAt: now,
        respondedByUserId: user.id,
        responseSource: "compass",
        updatedAt: now,
      })
      .where(eq(scheduleTaskAssignees.id, assignment.id))
    await recordActivityEvent({
      db,
      organizationId: project.organizationId,
      projectId: assignment.projectId,
      actor: user,
      category: "schedule",
      action: `schedule.assignee_${responseInput.response}`,
      entityType: "schedule_item",
      entityId: assignment.taskId,
      summary: `Recorded ${responseInput.response} response for “${assignment.title}”.`,
      metadata: {
        assignmentId,
        proposedStartDate: responseInput.proposedStartDate ?? null,
        proposedWorkdays: responseInput.proposedWorkdays ?? null,
        message: responseInput.message ?? null,
      },
    })
    try {
      await notifyInternalScheduleResponse({
        db,
        organizationId: project.organizationId,
        projectId: assignment.projectId,
        taskId: assignment.taskId,
        taskTitle: assignment.title,
        actorId: user.id,
        actorName: user.displayName ?? user.email,
        response: responseInput.response,
        note: responseInput.message,
        proposal:
          responseInput.response === "proposed"
            ? {
                startDate: responseInput.proposedStartDate?.trim() || null,
                workdays: responseInput.proposedWorkdays ?? null,
                note: responseInput.message?.trim() || null,
                submittedAt: now,
              }
            : undefined,
      })
    } catch (error) {
      console.error("Unable to notify internal schedule recipients", error)
    }
    revalidateConfirmationPaths(assignment.projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to respond to schedule assignee", error)
    return { success: false, error: "Unable to save your response." }
  }
}

export const respondToScheduleTaskAssignment = respondToScheduleTaskAssignee
export const updateScheduleTaskAssignees = setScheduleTaskAssignees
