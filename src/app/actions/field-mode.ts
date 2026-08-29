"use server"

import { and, asc, eq, inArray } from "drizzle-orm"

import { getMessages, sendMessage } from "@/app/actions/chat-messages"
import { listChannels } from "@/app/actions/conversations"
import { getNotificationCenter } from "@/app/actions/notifications"
import {
  listProjectDriveFilesForField,
  listProjectDriveFolderForField,
} from "@/app/actions/google-drive"
import {
  createProjectDailyLog,
  getProjectDailyLogWorkspace,
} from "@/app/actions/project-field"
import { getSchedule } from "@/app/actions/schedule"
import { getDb } from "@/db"
import {
  organizationMembers,
  projectMembers,
  projectOperations,
  projects,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import type {
  FieldDailyLogDraft,
  FieldDocument,
  FieldProject,
  FieldProjectPacket,
} from "@/lib/field/types"
import { isTaskAssignedToFieldUser } from "@/lib/field/task-assignment"
import { assertFieldProjectMembership } from "@/lib/field/project-access"
import { orderDirectConversationsByActivity } from "@/lib/field/direct-conversations"
import {
  isReviewSampleProject,
  reviewSampleDocuments,
} from "@/lib/field/review-sample"
import {
  isInternalStaffRole,
  userRoleLabel,
} from "@/lib/user-roles"

type FieldMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type FieldDailyLogMutationResult =
  | { readonly success: true; readonly dailyLogId: string }
  | { readonly success: false; readonly error: string }

type FieldDocumentFolderResult =
  | {
      readonly success: true
      readonly folder: { readonly id: string; readonly name: string }
      readonly documents: readonly FieldDocument[]
    }
  | { readonly success: false; readonly error: string }

export async function getFieldDocumentFolder(
  projectId: string,
  folderId: string
): Promise<FieldDocumentFolderResult> {
  const result = await listProjectDriveFolderForField(projectId, folderId)
  if (!result.success) return result

  return {
    success: true,
    folder: { id: folderId, name: result.folderName },
    documents: result.files.slice(0, 100).map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      mimeType: file.mimeType ?? null,
      modifiedAt: file.modifiedAt,
      webViewLink: file.webViewLink ?? null,
    })),
  }
}

export async function getActiveFieldProjects(): Promise<readonly FieldProject[]> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // Field Mode is intentionally narrower than Full Compass: every user sees
  // only jobs where they are an explicit project member.
  return db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.userId, user.id),
        eq(projects.status, "OPEN")
      )
    )
    .orderBy(asc(projects.projectNumber), asc(projects.name))
}

export async function getFieldProjectPacket(
  projectId: string
): Promise<FieldProjectPacket> {
  const user = await requireAuth()
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertFieldProjectMembership(db, user.id, projectId)

  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      status: projects.status,
      googleDriveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .get()

  if (!project || project.status !== "OPEN") {
    throw new Error("This project is not active.")
  }

  const filePromise = listProjectDriveFilesForField(projectId)

  const contactPromise = user.organizationId
    ? db
        .select({
          id: users.id,
          name: users.displayName,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .innerJoin(
          organizationMembers,
          eq(organizationMembers.userId, users.id)
        )
        .where(
          and(
            eq(users.isActive, true),
            eq(organizationMembers.organizationId, user.organizationId)
          )
        )
        .orderBy(asc(users.displayName), asc(users.email))
    : Promise.resolve([])

  const [schedule, operationTasks, dailyLogWorkspace, channelResult, fileResult, notificationResult, contactRows] =
    await Promise.all([
      getSchedule(projectId),
      db
        .select({
          id: projectOperations.id,
          title: projectOperations.title,
          description: projectOperations.description,
          status: projectOperations.status,
          priority: projectOperations.priority,
          assigneeName: projectOperations.assigneeName,
          startDate: projectOperations.startDate,
          dueDate: projectOperations.dueDate,
        })
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            inArray(projectOperations.sourceRecordType, [
              "staff_task",
              "subcontractor_task",
              "supplier_task",
            ])
          )
        )
        .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title)),
      getProjectDailyLogWorkspace(projectId),
      listChannels(),
      filePromise,
      getNotificationCenter(),
      contactPromise,
    ])

  const projectChannels = channelResult.success && channelResult.data
    ? channelResult.data.filter(
        (channel) =>
          channel.projectId === projectId &&
          channel.type !== "voice" &&
          channel.archivedAt === null
      )
    : []
  const channel = projectChannels[0] ?? null
  const directChannels = channelResult.success && channelResult.data
    ? orderDirectConversationsByActivity(
        channelResult.data.filter(
          (candidate) =>
            candidate.type === "text" &&
            candidate.isPrivate &&
            candidate.projectId === null &&
            candidate.archivedAt === null &&
            candidate.memberRole !== null
        )
      )
    : []
  const messageResult = channel
    ? await getMessages(channel.id, { limit: 30 })
    : null
  const directConversationResults: Array<{
    readonly channel: (typeof directChannels)[number]
    readonly result: Awaited<ReturnType<typeof getMessages>>
  }> = []

  // Each message read performs several D1 queries. Loading every direct
  // conversation in one Promise.all can exceed the Worker's concurrent D1
  // connection allowance and silently turn otherwise valid threads empty.
  for (const directChannel of directChannels) {
    directConversationResults.push({
      channel: directChannel,
      result: await getMessages(directChannel.id, { limit: 12 }),
    })
  }
  const sampleDocuments = reviewSampleDocuments(projectId)
  const scheduleItems: FieldProjectPacket["tasks"] = schedule.tasks.map(
    (task) => ({
      id: task.id,
      kind: "schedule",
      title: task.title,
      description: null,
      startDate: task.startDate,
      endDate: task.endDateCalculated,
      phase: task.phase,
      status: task.status,
      priority: task.isCriticalPath ? "critical" : "normal",
      percentComplete: task.percentComplete,
      isCriticalPath: task.isCriticalPath,
      isMilestone: task.isMilestone,
      assignedTo: task.assignedTo,
    })
  )
  const assignedTaskItems: FieldProjectPacket["tasks"] = operationTasks
    .filter(
      (task) =>
        isReviewSampleProject(projectId) ||
        isTaskAssignedToFieldUser(task.assigneeName, user)
    )
    .map((task) => ({
      id: task.id,
      kind: "task",
      title: task.title,
      description: task.description,
      startDate: task.startDate ?? task.dueDate ?? "",
      endDate: task.dueDate ?? task.startDate ?? "",
      phase: "Assigned task",
      status: task.status,
      priority: task.priority,
      percentComplete: task.status === "complete" ? 100 : 0,
      isCriticalPath: false,
      isMilestone: false,
      assignedTo: task.assigneeName,
    }))

  return {
    project: {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
      address: project.address,
    },
    tasks: [...scheduleItems, ...assignedTaskItems],
    logs: dailyLogWorkspace.logs.slice(0, 30).map((log) => ({
      id: log.id,
      logDate: log.logDate,
      workCompleted: log.workCompleted,
      issues: log.issues,
      notes: log.notes,
      authorName: log.authorName,
      syncStatus: log.syncStatus,
    })),
    documents: sampleDocuments.length > 0
      ? [...sampleDocuments]
      : fileResult.success
        ? fileResult.files.slice(0, 100).map((file) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            mimeType: file.mimeType ?? null,
            modifiedAt: file.modifiedAt,
            webViewLink: file.webViewLink ?? null,
          }))
        : [],
    channel: channel ? { id: channel.id, name: channel.name } : null,
    messages: messageResult?.success && messageResult.data
      ? messageResult.data
          .slice()
          .reverse()
          .map((message) => ({
            id: message.id,
            content: message.content,
            createdAt: message.createdAt,
            userName:
              message.user?.displayName ?? message.user?.email ?? "Compass user",
          }))
      : [],
    directConversations: directConversationResults.map(({ channel, result }) => ({
      id: channel.id,
      name: channel.name,
      unreadCount: channel.unreadCount ?? 0,
      messages: result.success && result.data
        ? result.data
            .slice()
            .reverse()
            .map((message) => ({
              id: message.id,
              content: message.content,
              createdAt: message.createdAt,
              userName:
                message.user?.displayName ??
                message.user?.email ??
                "Compass user",
            }))
        : [],
    })),
    contacts: contactRows
      .filter(
        (contact) =>
          contact.id !== user.id && isInternalStaffRole(contact.role)
      )
      .map((contact) => ({
        id: contact.id,
        name: contact.name ?? contact.email.split("@")[0] ?? contact.email,
        email: contact.email,
        role: userRoleLabel(contact.role),
      })),
    notifications: notificationResult.success
      ? notificationResult.data.items.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          href: item.href,
          projectId: item.projectId,
          readAt: item.readAt,
          createdAt: item.createdAt,
        }))
      : [],
    syncedAt: new Date().toISOString(),
  }
}

export async function submitFieldDailyLog(
  projectId: string,
  draft: FieldDailyLogDraft,
  clientSubmissionId?: string
): Promise<FieldDailyLogMutationResult> {
  const result = await createProjectDailyLog(projectId, {
    clientSubmissionId,
    logDate: draft.logDate,
    weatherTempF: null,
    weatherConditions: "",
    weatherPrecipitation: "",
    workCompleted: draft.workCompleted,
    issues: draft.issues,
    materialsUsed: "",
    crewPresent: draft.crewPresent,
    hoursWorked: null,
    safetyIncidents: "",
    visitorLog: "",
    notes: draft.notes,
  })

  return result.success
    ? { success: true, dailyLogId: result.dailyLogId }
    : { success: false, error: result.error ?? "Unable to send the message." }
}

export async function submitFieldChatMessage(
  channelId: string,
  content: string
): Promise<FieldMutationResult> {
  const result = await sendMessage({ channelId, content })
  return result.success
    ? { success: true }
    : { success: false, error: result.error ?? "Unable to send the message." }
}
