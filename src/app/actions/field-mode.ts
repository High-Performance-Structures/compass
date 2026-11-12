"use server"

import { and, asc, eq, inArray } from "drizzle-orm"

import { sendMessage } from "@/app/actions/chat-messages"
import { readChannelMessages as getMessages } from "@/lib/domain/conversations/messages"
import { readVisibleChannels as listChannels } from "@/lib/domain/conversations/channels"
import { getNotificationCenter } from "@/app/actions/notifications"
import {
  listProjectDriveFilesForField,
  listProjectDriveFolderForField,
} from "@/app/actions/google-drive-field"
import {
  createProjectDailyLog,
  getProjectDailyLogWorkspace,
} from "@/app/actions/project-field"
import { readProjectSchedule } from "@/lib/domain/schedule/access"
import { projectOperations } from "@/db/schema"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { channels } from "@/db/schema-conversations"
import { phoneDailyLogForm } from "@/lib/daily-logs/cost-code-lines"
import { loadFieldMachines } from "@/lib/equipment/field"
import { companyToday } from "@/lib/internal-duties/recurring-data"
import type {
  FieldDailyLogDraft,
  FieldDocument,
  FieldProject,
  FieldProjectPacket,
} from "@/lib/field/types"
import { isTaskAssignedToFieldUser } from "@/lib/field/task-assignment"
import { assertFieldAppProjectAccess, FIELD_PROJECT_NOT_ASSIGNED, listFieldAppProjects } from "@/lib/domain/field/field-app-access"
import { requireUserContext } from "@/lib/server/action-context"
import { orderDirectConversationsByActivity } from "@/lib/field/direct-conversations"
import {
  isInternalStaffRole,
  userRoleLabel,
} from "@/lib/user-roles"

const people = peopleView()
const memberships = membershipsView()

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
  const { db, user } = await requireUserContext()
  // The field app lists the jobs switched on for it (Settings › Workflows ›
  // Field app) that the person is a member of, or every such job of their
  // company when they are an active Sage employee (field-app-access.ts).
  return listFieldAppProjects(db, user)
}

export async function getFieldProjectPacket(
  projectId: string
): Promise<FieldProjectPacket> {
  const { db, user } = await requireUserContext()
  // Throws when the job isn't in the field app or isn't this person's.
  const { project } = await assertFieldAppProjectAccess(db, user, projectId)

  const filePromise = listProjectDriveFilesForField(projectId)
  // Machines are company-wide; only staff log them.
  const machinesPromise = user.organizationId && isInternalStaffRole(user.role)
    ? loadFieldMachines(db, user.organizationId, companyToday())
    : Promise.resolve([])

  const contactPromise = user.organizationId
    ? db
        .select({
          id: people.id,
          name: people.displayName,
          email: people.email,
          role: people.role,
        })
        .from(people)
        .innerJoin(
          memberships,
          eq(memberships.userId, people.id)
        )
        .where(
          and(
            eq(people.isActive, true),
            eq(memberships.organizationId, user.organizationId)
          )
        )
        .orderBy(asc(people.displayName), asc(people.email))
    : Promise.resolve([])

  const [schedule, operationTasks, dailyLogWorkspace, channelResult, fileResult, notificationResult, contactRows] =
    await Promise.all([
      readProjectSchedule(projectId),
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
    .filter((task) => isTaskAssignedToFieldUser(task.assigneeName, user))
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
      completedTodos: log.completedTodos.map((todo) => ({ ...todo })),
    })),
    documents: fileResult.success
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
    // Download only the curated phone codes; the full catalog stays in Full Compass.
    dailyLogForm: {
      ...phoneDailyLogForm(dailyLogWorkspace.form),
      followUps: dailyLogWorkspace.followUps
        ? {
            rules: { ...dailyLogWorkspace.followUps.rules, todoTypes: [...dailyLogWorkspace.followUps.rules.todoTypes] },
            openTodos: dailyLogWorkspace.followUps.openTodos.map((todo) => ({ ...todo })),
            doneStatusLabel: dailyLogWorkspace.followUps.doneStatusLabel,
            clientContacts: dailyLogWorkspace.followUps.clientContacts.map((contact) => ({ ...contact })),
            assignees: dailyLogWorkspace.followUps.assignees.map((person) => ({ ...person })),
            installableSelections: (dailyLogWorkspace.followUps.installableSelections ?? []).map((selection) => ({ ...selection })),
          }
        : null,
    },
    machines: await machinesPromise,
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

/** The field app's single-job check, as an action result. */
async function fieldProjectFailure(projectId: string): Promise<{ readonly success: false; readonly error: string } | null> {
  try {
    const { db, user } = await requireUserContext()
    await assertFieldAppProjectAccess(db, user, projectId)
    return null
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : FIELD_PROJECT_NOT_ASSIGNED }
  }
}

export async function submitFieldDailyLog(
  projectId: string,
  draft: FieldDailyLogDraft,
  clientSubmissionId?: string
): Promise<FieldDailyLogMutationResult> {
  const refused = await fieldProjectFailure(projectId)
  if (refused) return refused
  const result = await createProjectDailyLog(projectId, {
    clientSubmissionId,
    logDate: draft.logDate,
    weatherTempF: null,
    weatherConditions: "",
    weatherPrecipitation: "",
    workCompleted: draft.workCompleted,
    issues: draft.issues,
    materialsUsed: draft.materialsUsed,
    crewPresent: draft.crewPresent,
    hoursWorked: null,
    safetyIncidents: draft.safetyIncidents,
    visitorLog: draft.visitorLog,
    notes: draft.notes,
    workLines: draft.workLines,
    ...(draft.followUps ? { followUps: draft.followUps } : {}),
    // Saved on a phone, maybe before a code was taken off the list.
    queuedOnDevice: true,
  })

  return result.success
    ? { success: true, dailyLogId: result.dailyLogId }
    : { success: false, error: result.error ?? "Unable to send the message." }
}

export async function submitFieldChatMessage(
  channelId: string,
  content: string
): Promise<FieldMutationResult> {
  // A project conversation follows the job's field app access; direct
  // conversations have no project and keep their own membership rules.
  const { db } = await requireUserContext()
  const channel = await db
    .select({ projectId: channels.projectId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
  const channelProjectId = channel[0]?.projectId ?? null
  if (channelProjectId) {
    const refused = await fieldProjectFailure(channelProjectId)
    if (refused) return refused
  }
  const result = await sendMessage({ channelId, content })
  return result.success
    ? { success: true }
    : { success: false, error: result.error ?? "Unable to send the message." }
}
