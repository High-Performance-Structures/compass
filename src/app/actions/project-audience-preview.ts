"use server"

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  ownerProjectUpdates,
  projectContacts,
  projectMembers,
  projectOperations,
  projectRfis,
  projects,
  schedulePublications,
  scheduleTasks,
} from "@/db/schema"
import { scheduleTaskAssignees, projectSourceRecordParticipants } from "@/db/schema-participants"
import { channelMembers, channels } from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { getProjectAudienceStaff } from "@/lib/project-audience-staff"
import { selectProjectAudienceScheduleItems } from "@/lib/project-audience-schedule-visibility"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  isPortalVisiblePurchaseOrderStatus,
  parsePortalPurchaseOrderPayload,
  portalPurchaseOrderMatchesRecipient,
  type PortalPurchaseOrderAcknowledgement,
} from "@/lib/purchase-orders/portal-response"
import {
  isOwnerScheduleView,
  summarizeOwnerScheduleByPhase,
  type OwnerScheduleView,
} from "@/lib/schedule/owner-visibility"
import { parsePublishedScheduleSnapshot } from "@/lib/schedule/publications"
import { projectAudiencePhotoUrl } from "@/lib/photo-sources"
import { canViewerConfirmScheduleTask } from "@/lib/schedule/confirmation"
import { sameScheduleAssigneeSet } from "@/lib/schedule/multi-assignee"
import { isWarrantyProjectStage } from "@/lib/warranty/status"
import { gotoSenderNumberForProject } from "@/lib/goto/numbers"
import {
  isPortalVisibleRfqStatus,
  parsePortalRfqPayload,
  portalRfqMatchesRecipient,
  type PortalRfqDocumentLink,
  type PortalRfqScopeItem,
  type PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

export type { ProjectAudience } from "@/lib/project-audience-access"

export type AudiencePhoto = {
  readonly id: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly photoDate: string
  readonly schedulePhase: string
  readonly schedulePhaseConfidence: number
  readonly schedulePhaseReason: string
}

export type AudienceScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly workdays: number
  readonly status: string
  readonly phase: string
  readonly displayColor: string | null
  readonly assignedTo: string | null
  readonly percentComplete: number
  readonly isMilestone: boolean
  readonly confirmationRequired: boolean
  readonly confirmationStatus: string
  readonly viewerCanConfirm: boolean
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly proposalNote: string | null
  readonly proposalSubmittedAt: string | null
  readonly assignees: readonly AudienceScheduleAssignee[]
}

export type AudienceScheduleAssignee = {
  readonly id: string
  readonly assignedUserId: string | null
  readonly projectContactId: string | null
  readonly displayName: string | null
  readonly responseStatus: string
  readonly dateResponseStatus: string
  readonly durationResponseStatus: string
  readonly proposedStartDate: string | null
  readonly proposedWorkdays: number | null
  readonly responseMessage: string | null
  readonly viewerCanRespond: boolean
}

export type AudienceOperationItem = {
  readonly id: string
  readonly sourceRecordType: string
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly acknowledgement: PortalPurchaseOrderAcknowledgement | null
}

export type AudienceOwnerUpdate = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly summary: string
  readonly publishedAt: string | null
}

export type AudienceProjectOption = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly status: string
}

export type AudienceRfi = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly priority: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly answeredAt: string | null
}

export type AudienceRfq = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly companyName: string | null
  readonly vendorCategory: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly scopeItems: readonly PortalRfqScopeItem[]
  readonly documentLinks: readonly PortalRfqDocumentLink[]
  readonly vendorResponse: PortalRfqVendorResponse | null
}

export type AudienceMessageChannel = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly isPrivate: boolean
}

export type AudienceContact = {
  readonly id: string
  readonly userId: string | null
  readonly contactType: string
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly primaryContact: boolean
}

export type ProjectAudiencePreview = {
  readonly audience: ProjectAudience
  readonly viewerIsInternal: boolean
  readonly viewer: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly avatarUrl: string | null
    readonly sidebarPhotoUrl: string | null
  }
  readonly projectOptions: readonly AudienceProjectOption[]
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly textPhoneNumber: string
    readonly address: string | null
    readonly clientName: string | null
    readonly projectManager: string | null
    readonly ownerScheduleView: OwnerScheduleView
    readonly warrantyEnabled: boolean
  }
  readonly ownerUpdates: readonly AudienceOwnerUpdate[]
  readonly photos: readonly AudiencePhoto[]
  readonly scheduleItems: readonly AudienceScheduleItem[]
  readonly operations: readonly AudienceOperationItem[]
  readonly rfis: readonly AudienceRfi[]
  readonly rfqs: readonly AudienceRfq[]
  readonly messageChannels: readonly AudienceMessageChannel[]
  readonly contacts: readonly AudienceContact[]
}

async function verifyProjectAccess(
  projectId: string,
  audience: ProjectAudience
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly viewerIsInternal: boolean
  readonly viewer: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly avatarUrl: string | null
    readonly sidebarPhotoUrl: string | null
  }
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const project = await assertProjectAccess(db, user, projectId)
  if (!project.organizationId) {
    throw new Error("Project organization is missing")
  }
  const viewerIsInternal = isInternalStaffRole(user.role)
  if (!viewerIsInternal) {
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, user.id)
        )
      )
      .get()
    if (!canUseProjectAudience(membership?.role ?? null, audience)) {
      throw new Error("Project not found")
    }
  }

  return {
    db,
    env,
    organizationId: project.organizationId,
    viewerIsInternal,
    viewer: {
      id: user.id,
      name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
      email: user.email,
      avatarUrl: user.avatarUrl,
      sidebarPhotoUrl: user.sidebarDeskPhotoUrl ?? null,
    },
  }
}

function isActiveStatus(value: string): boolean {
  return !["complete", "completed", "cancelled", "closed", "void"].includes(
    value.toLowerCase()
  )
}

function isSubVendorOperation(value: string): boolean {
  return [
    "purchase_order",
    "subcontractor_task",
    "supplier_task",
    "schedule_task",
  ].includes(value)
}

function isImage(value: {
  readonly mimeType: string | null
  readonly thumbnailUrl: string | null
}): boolean {
  return value.thumbnailUrl !== null || value.mimeType?.startsWith("image/") === true
}

function photoDate(value: {
  readonly capturedAt: string | null
  readonly logDate: string | null
  readonly createdAt: string
}): string {
  if (value.capturedAt) return value.capturedAt.slice(0, 10)
  if (value.logDate) return value.logDate
  return value.createdAt.slice(0, 10)
}

export async function getProjectAudiencePreview(
  projectId: string,
  audience: ProjectAudience
): Promise<ProjectAudiencePreview> {
  const { db, env, organizationId, viewerIsInternal, viewer } =
    await verifyProjectAccess(projectId, audience)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      projectManager: projects.projectManager,
      ownerScheduleView: projects.ownerScheduleView,
      status: projects.status,
      jobStatusId: projects.jobStatusId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error("Project not found")
  }

  const projectOptions: readonly AudienceProjectOption[] = viewerIsInternal
    ? [
        {
          id: project.id,
          name: project.name,
          projectNumber: project.projectNumber,
          status: project.status,
        },
      ]
    : await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
          status: projects.status,
          projectRole: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(
          and(
            eq(projectMembers.userId, viewer.id),
            eq(projects.organizationId, organizationId)
          )
        )
        .orderBy(asc(projects.projectNumber), asc(projects.name))
        .then((rows) =>
          rows
            .filter((row) =>
              canUseProjectAudience(row.projectRole, audience)
            )
            .map((row) => ({
              id: row.id,
              name: row.name,
              projectNumber: row.projectNumber,
              status: row.status,
            }))
        )

  const resolvedViewerContact =
    !viewerIsInternal
      ? await getProjectAudienceViewerContact(db, projectId, {
          id: viewer.id,
          email: viewer.email,
        })
      : null
  const viewerContact =
    resolvedViewerContact &&
    ((audience === "owner" && resolvedViewerContact.contactType === "owner") ||
      (audience === "sub_vendor" &&
        (resolvedViewerContact.contactType === "supplier" ||
          resolvedViewerContact.contactType === "subcontractor")))
      ? resolvedViewerContact
      : null

  const visibilityFilter =
    audience === "owner"
      ? or(
          eq(dailyLogPhotos.ownerVisible, true),
          eq(dailyLogPhotos.publicShareable, true)
        )
      : or(
          eq(dailyLogPhotos.subVendorVisible, true),
          eq(dailyLogPhotos.publicShareable, true)
        )

  const photoRows = await db
    .select({
      id: dailyLogPhotos.id,
      fileName: dailyLogPhotos.fileName,
      driveFileId: dailyLogPhotos.driveFileId,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      mimeType: dailyLogPhotos.mimeType,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      createdAt: dailyLogPhotos.createdAt,
      logDate: dailyLogs.logDate,
      logWorkCompleted: dailyLogs.workCompleted,
      logIssues: dailyLogs.issues,
      logNotes: dailyLogs.notes,
      photoKind: dailyLogPhotos.photoKind,
      schedulePhaseOverride: dailyLogPhotos.schedulePhaseOverride,
    })
    .from(dailyLogPhotos)
    .leftJoin(dailyLogs, eq(dailyLogPhotos.dailyLogId, dailyLogs.id))
    .where(
      and(
        eq(dailyLogPhotos.projectId, projectId),
        eq(dailyLogPhotos.reviewStatus, "approved"),
        visibilityFilter
      )
    )
    .orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt))

  const currentScheduleRows = await db
    .select({
      id: scheduleTasks.id,
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      displayColor: scheduleTasks.displayColor,
      status: scheduleTasks.status,
      phase: scheduleTasks.phase,
      assignedTo: scheduleTasks.assignedTo,
      percentComplete: scheduleTasks.percentComplete,
      isMilestone: scheduleTasks.isMilestone,
      workdays: scheduleTasks.workdays,
      assignedUserId: scheduleTasks.assignedUserId,
      ownerVisible: scheduleTasks.ownerVisible,
      subVendorVisible: scheduleTasks.subVendorVisible,
      confirmationRequired: scheduleTasks.confirmationRequired,
      confirmationStatus: scheduleTasks.confirmationStatus,
      confirmationRequestedAt: scheduleTasks.confirmationRequestedAt,
      confirmationRespondedAt: scheduleTasks.confirmationRespondedAt,
      reminderSentAt: scheduleTasks.reminderSentAt,
      proposedStartDate: scheduleTasks.proposedStartDate,
      proposedWorkdays: scheduleTasks.proposedWorkdays,
      proposalNote: scheduleTasks.proposalNote,
      proposalSubmittedAt: scheduleTasks.proposalSubmittedAt,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
  // External viewers only receive the child row that they can answer. This
  // keeps another assignee's private response message and proposal private.
  const scheduleAssigneeRows = await db
    .select({
      id: scheduleTaskAssignees.id,
      scheduleTaskId: scheduleTaskAssignees.scheduleTaskId,
      participantId: scheduleTaskAssignees.participantId,
      assignedUserId: scheduleTaskAssignees.assignedUserId,
      projectContactId: scheduleTaskAssignees.projectContactId,
      responseStatus: scheduleTaskAssignees.responseStatus,
      dateResponseStatus: scheduleTaskAssignees.dateResponseStatus,
      durationResponseStatus: scheduleTaskAssignees.durationResponseStatus,
      proposedStartDate: scheduleTaskAssignees.proposedStartDate,
      proposedWorkdays: scheduleTaskAssignees.proposedWorkdays,
      responseMessage: scheduleTaskAssignees.responseMessage,
      displayName: projectSourceRecordParticipants.sourceContactName,
    })
    .from(scheduleTaskAssignees)
    .innerJoin(
      projectSourceRecordParticipants,
      eq(
        projectSourceRecordParticipants.id,
        scheduleTaskAssignees.participantId,
      ),
    )
    .where(
      inArray(
        scheduleTaskAssignees.scheduleTaskId,
        currentScheduleRows.map((task) => task.id),
      ),
    )
    .catch(() => [])
  const scheduleAssigneesByTask = new Map<string, typeof scheduleAssigneeRows>()
  for (const row of scheduleAssigneeRows) {
    const existing = scheduleAssigneesByTask.get(row.scheduleTaskId) ?? []
    existing.push(row)
    scheduleAssigneesByTask.set(row.scheduleTaskId, existing)
  }
  const visibleScheduleAssigneesByTask = new Map<
    string,
    typeof scheduleAssigneeRows
  >()
  for (const row of scheduleAssigneeRows) {
    if (
      !viewerIsInternal &&
      row.assignedUserId !== viewer.id &&
      row.projectContactId !== viewerContact?.id
    ) {
      continue
    }
    const existing =
      visibleScheduleAssigneesByTask.get(row.scheduleTaskId) ?? []
    existing.push(row)
    visibleScheduleAssigneesByTask.set(row.scheduleTaskId, existing)
  }
  const publishedSchedule = await db
    .select({ snapshotData: schedulePublications.snapshotData })
    .from(schedulePublications)
    .where(eq(schedulePublications.projectId, projectId))
    .orderBy(desc(schedulePublications.publishedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const publishedSnapshot = publishedSchedule
    ? parsePublishedScheduleSnapshot(publishedSchedule.snapshotData)
    : null
  // Once a publication exists, fail closed if its immutable snapshot cannot
  // be parsed. Falling back to live rows could expose unpublished changes.
  const currentScheduleById = new Map(
    currentScheduleRows.map((task) => [task.id, task])
  )
  const scheduleRowsUnsorted = publishedSchedule
    ? publishedSnapshot
      ? publishedSnapshot.tasks.map((task) => {
          const currentTask = currentScheduleById.get(task.id)
          const assigneeSetMatches = sameScheduleAssigneeSet(
            (scheduleAssigneesByTask.get(task.id) ?? []).map(
              (assignee) => assignee.participantId,
            ),
            task.assigneeParticipantIds,
          )
          // External dates always come from the immutable publication. Only
          // response state may move live, and only while that publication
          // still describes the current assignment and dates.
          const canOverlayResponse =
            currentTask?.assignedUserId === task.assignedUserId &&
            currentTask.confirmationRequired === task.confirmationRequired &&
            currentTask.startDate === task.startDate &&
            currentTask.workdays === task.workdays &&
            assigneeSetMatches
          return {
            id: task.id,
            title: task.title,
            startDate: task.startDate,
            endDate: task.endDateCalculated,
            displayColor: task.displayColor,
            status: task.status,
            phase: task.phase,
            assignedTo: task.assignedTo,
            percentComplete: task.percentComplete,
            isMilestone: task.isMilestone,
            workdays: task.workdays,
            assignedUserId: task.assignedUserId,
            ownerVisible: task.ownerVisible,
            subVendorVisible: task.subVendorVisible,
            confirmationRequired: task.confirmationRequired,
            confirmationStatus: canOverlayResponse
              ? currentTask.confirmationStatus
              : task.confirmationStatus,
            confirmationRequestedAt: task.confirmationRequestedAt,
            confirmationRespondedAt: canOverlayResponse
              ? currentTask.confirmationRespondedAt
              : task.confirmationRespondedAt,
            reminderSentAt: canOverlayResponse
              ? currentTask.reminderSentAt
              : task.reminderSentAt,
            proposedStartDate: canOverlayResponse
              ? currentTask.proposedStartDate
              : task.proposedStartDate,
            proposedWorkdays: canOverlayResponse
              ? currentTask.proposedWorkdays
              : task.proposedWorkdays,
            proposalNote: canOverlayResponse
              ? currentTask.proposalNote
              : task.proposalNote,
            proposalSubmittedAt: canOverlayResponse
              ? currentTask.proposalSubmittedAt
              : task.proposalSubmittedAt,
            legacyResponseAllowed:
              canOverlayResponse && task.assigneeParticipantIds.length === 0,
            assignees: canOverlayResponse
              ? visibleScheduleAssigneesByTask.get(task.id) ?? []
              : [],
          }
        })
      : []
    : currentScheduleRows.map((task) => ({
        ...task,
        legacyResponseAllowed:
          (scheduleAssigneesByTask.get(task.id) ?? []).length === 0,
        assignees: visibleScheduleAssigneesByTask.get(task.id) ?? [],
      }))
  const scheduleRows = [...scheduleRowsUnsorted].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id)
  )

  const ownerUpdateRows =
    audience === "owner"
      ? await db
          .select({
            id: ownerProjectUpdates.id,
            title: ownerProjectUpdates.title,
            updateDate: ownerProjectUpdates.updateDate,
            summary: ownerProjectUpdates.summary,
            publishedAt: ownerProjectUpdates.publishedAt,
          })
          .from(ownerProjectUpdates)
          .where(
            and(
              eq(ownerProjectUpdates.projectId, projectId),
              eq(ownerProjectUpdates.status, "published")
            )
          )
          .orderBy(
            desc(ownerProjectUpdates.updateDate),
            desc(ownerProjectUpdates.createdAt)
          )
          .limit(3)
      : []

  const operationRows =
    audience === "sub_vendor"
      ? await db
          .select({
            id: projectOperations.id,
            sourceRecordType: projectOperations.sourceRecordType,
            sourceRecordNumber: projectOperations.sourceRecordNumber,
            title: projectOperations.title,
            status: projectOperations.status,
            priority: projectOperations.priority,
            assigneeName: projectOperations.assigneeName,
            companyName: projectOperations.companyName,
            description: projectOperations.description,
            startDate: projectOperations.startDate,
            dueDate: projectOperations.dueDate,
            amount: projectOperations.amount,
            sageVendorName: projectOperations.sageVendorName,
            sagePayloadJson: projectOperations.sagePayloadJson,
          })
          .from(projectOperations)
          .where(eq(projectOperations.projectId, projectId))
          .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))
      : []

  const rfiVisibility =
    audience === "owner"
      ? or(eq(projectRfis.audience, "owner"), eq(projectRfis.audience, "public"))
      : or(
          eq(projectRfis.audience, "sub_vendor"),
          eq(projectRfis.audience, "public")
        )

  const rfiRows = await db
    .select({
      id: projectRfis.id,
      rfiNumber: projectRfis.rfiNumber,
      subject: projectRfis.subject,
      question: projectRfis.question,
      answer: projectRfis.answer,
      status: projectRfis.status,
      priority: projectRfis.priority,
      requesterName: projectRfis.requesterName,
      assignedToName: projectRfis.assignedToName,
      companyName: projectRfis.companyName,
      dueDate: projectRfis.dueDate,
      submittedAt: projectRfis.submittedAt,
      answeredAt: projectRfis.answeredAt,
    })
    .from(projectRfis)
    .where(and(eq(projectRfis.projectId, projectId), rfiVisibility))
    .orderBy(asc(projectRfis.dueDate), desc(projectRfis.submittedAt))

  const audienceContactId =
    viewerIsInternal
      ? null
      : viewerContact?.id ?? null
  if (
    audience === "owner" ||
    (!viewerIsInternal && audienceContactId !== null)
  ) {
    await ensureProjectAudienceConversation({
      db,
      projectId,
      organizationId,
      audience,
      contactId: audience === "owner" ? null : audienceContactId,
      externalUserId: viewerIsInternal ? null : viewer.id,
      createdBy: viewer.id,
      now: new Date().toISOString(),
    })
  }

  const channelAudience =
    audience === "owner" ? "clients" : "sub_vendors"
  const messageChannelRows = await db
    .select({
      id: channels.id,
      name: channels.name,
      description: channels.description,
      isPrivate: channels.isPrivate,
    })
    .from(channels)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channels.id),
        eq(channelMembers.userId, viewer.id)
      )
    )
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.projectId, projectId),
        eq(channels.type, "text"),
        eq(channels.audience, channelAudience),
        isNull(channels.archivedAt)
      )
    )
    .orderBy(asc(channels.sortOrder), asc(channels.name))

  const internalTeamRows = await getProjectAudienceStaff(db, {
    projectId,
    organizationId,
    audience,
  })
  const visibleContactRows: readonly AudienceContact[] = internalTeamRows.map((member) => ({
    id: member.contactId,
    userId: member.userId,
    contactType: "internal",
    displayName: member.displayName,
    companyName: member.companyName,
    role: member.role,
    trade: member.trade,
    csiDivision: member.csiDivision,
    csiDivisionName: member.csiDivisionName,
    email: member.email,
    phone: member.phone,
    primaryContact: member.primaryContact,
  }))
  const externalContactRows =
    audience === "sub_vendor"
      ? await db
          .select({
            id: projectContacts.id,
            displayName: projectContacts.displayName,
            companyName: projectContacts.companyName,
            email: projectContacts.email,
          })
          .from(projectContacts)
          .where(
            and(
              eq(projectContacts.projectId, projectId),
              eq(projectContacts.active, true),
              or(
                eq(projectContacts.contactType, "supplier"),
                eq(projectContacts.contactType, "subcontractor")
              )
            )
          )
      : []
  const ownerScheduleView =
    audience === "owner" && isOwnerScheduleView(project.ownerScheduleView)
      ? project.ownerScheduleView
      : "items"
  const audienceScheduleRows = selectProjectAudienceScheduleItems(
    scheduleRows,
    audience
  )
  const visibleScheduleItem = (
    item: (typeof audienceScheduleRows)[number]
  ): AudienceScheduleItem => ({
    id: item.id,
    title: item.title,
    startDate: item.startDate,
    endDate: item.endDate,
    workdays: item.workdays,
    status: item.status,
    phase: item.phase,
    displayColor: item.displayColor,
    assignedTo: item.assignedTo,
    percentComplete: item.percentComplete,
    isMilestone: item.isMilestone,
    confirmationRequired: item.confirmationRequired,
    confirmationStatus: item.confirmationStatus,
    viewerCanConfirm: item.legacyResponseAllowed && item.assignees.length === 0 && audience === "sub_vendor" &&
      canViewerConfirmScheduleTask({
        viewerIsInternal,
        viewerId: viewer.id,
        assignedUserId: item.assignedUserId,
        confirmationRequired: item.confirmationRequired,
      }),
    proposedStartDate:
      item.legacyResponseAllowed &&
      item.assignees.length === 0 &&
      item.assignedUserId === viewer.id
        ? item.proposedStartDate
        : null,
    proposedWorkdays:
      item.legacyResponseAllowed &&
      item.assignees.length === 0 &&
      item.assignedUserId === viewer.id
        ? item.proposedWorkdays
        : null,
    proposalNote:
      item.legacyResponseAllowed &&
      item.assignees.length === 0 &&
      item.assignedUserId === viewer.id
        ? item.proposalNote
        : null,
    proposalSubmittedAt:
      item.legacyResponseAllowed &&
      item.assignees.length === 0 &&
      item.assignedUserId === viewer.id
        ? item.proposalSubmittedAt
        : null,
    assignees: item.assignees.map((assignee) => {
      const viewerOwnsAssignee =
        assignee.assignedUserId === viewer.id ||
        assignee.projectContactId === viewerContact?.id
      return {
        id: assignee.id,
        assignedUserId: assignee.assignedUserId,
        projectContactId: assignee.projectContactId,
        displayName: assignee.displayName,
        responseStatus: assignee.responseStatus,
        dateResponseStatus: assignee.dateResponseStatus,
        durationResponseStatus: assignee.durationResponseStatus,
        proposedStartDate: viewerOwnsAssignee
          ? assignee.proposedStartDate
          : null,
        proposedWorkdays: viewerOwnsAssignee
          ? assignee.proposedWorkdays
          : null,
        responseMessage: viewerOwnsAssignee
          ? assignee.responseMessage
          : null,
        viewerCanRespond:
          item.confirmationRequired && !viewerIsInternal && viewerOwnsAssignee,
      }
    }),
  })
  const audienceScheduleItems: readonly AudienceScheduleItem[] =
    ownerScheduleView === "phases"
      ? summarizeOwnerScheduleByPhase(audienceScheduleRows).map((item) => ({
          ...item,
          confirmationRequired: false,
          confirmationStatus: "not_requested",
          viewerCanConfirm: false,
          proposedStartDate: null,
          proposedWorkdays: null,
          proposalNote: null,
          proposalSubmittedAt: null,
          assignees: [],
        }))
      : audienceScheduleRows.map(visibleScheduleItem)

  const audienceRfqs: readonly AudienceRfq[] = operationRows
    .filter((operation) => {
      if (
        operation.sourceRecordType !== "rfq" ||
        !isPortalVisibleRfqStatus(operation.status)
      ) {
        return false
      }
      if (viewerIsInternal) return true
      if (!viewerContact) return false
      const payload = parsePortalRfqPayload(operation.sagePayloadJson)
      return portalRfqMatchesRecipient({
        recipientEmail: payload.recipientEmail,
        companyName: operation.companyName,
        assigneeName: operation.assigneeName,
        viewerEmail: viewer.email,
        viewerCompanyName: viewerContact.companyName,
        viewerDisplayName: viewerContact.displayName,
      })
    })
    .map((operation) => {
      const payload = parsePortalRfqPayload(operation.sagePayloadJson)
      return {
        id: operation.id,
        number: operation.sourceRecordNumber,
        title: operation.title,
        description: operation.description,
        status: operation.status,
        priority: operation.priority,
        companyName: operation.companyName,
        vendorCategory: payload.vendorCategory,
        dueDate: operation.dueDate,
        amount: operation.amount,
        scopeItems: payload.scopeItems,
        documentLinks: payload.documentLinks,
        vendorResponse: payload.vendorResponse,
      }
    })

  const portalOperationContacts = viewerIsInternal
    ? externalContactRows
    : viewerContact
      ? [viewerContact]
      : []
  const audienceOperations: readonly AudienceOperationItem[] = operationRows
    .filter((operation) => {
      if (!isSubVendorOperation(operation.sourceRecordType)) return false
      if (operation.sourceRecordType === "purchase_order") {
        if (!isPortalVisiblePurchaseOrderStatus(operation.status)) return false
      } else if (!isActiveStatus(operation.status)) {
        return false
      }
      const payload = parsePortalPurchaseOrderPayload(operation.sagePayloadJson)
      return portalOperationContacts.some((contact) =>
        portalPurchaseOrderMatchesRecipient({
          // Internal previews represent the contact assignment, while a signed-in
          // vendor must also satisfy any explicit delivery email on the PO.
          recipientEmails: viewerIsInternal ? [] : payload.recipientEmails,
          companyName: operation.companyName,
          assigneeName: operation.assigneeName,
          vendorName: operation.sageVendorName,
          viewerEmail: viewerIsInternal ? contact.email ?? "" : viewer.email,
          viewerCompanyName: contact.companyName,
          viewerDisplayName: contact.displayName,
        })
      )
    })
    .map((operation) => {
      const payload = parsePortalPurchaseOrderPayload(operation.sagePayloadJson)
      return {
        id: operation.id,
        sourceRecordType: operation.sourceRecordType,
        sourceRecordNumber: operation.sourceRecordNumber,
        title: operation.title,
        description: operation.description,
        status: operation.status,
        priority: operation.priority,
        assigneeName: operation.assigneeName,
        companyName: operation.companyName,
        startDate: operation.startDate,
        dueDate: operation.dueDate,
        amount: operation.amount,
        acknowledgement:
          operation.sourceRecordType === "purchase_order"
            ? payload.acknowledgement
            : null,
      }
    })

  return {
    audience,
    viewerIsInternal,
    viewer,
    projectOptions,
    project: {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
      textPhoneNumber: gotoSenderNumberForProject(env, project.projectNumber),
      address: project.address,
      clientName: project.clientName,
      projectManager: project.projectManager,
      ownerScheduleView,
      warrantyEnabled: isWarrantyProjectStage({
        status: project.status,
        jobStatusId: project.jobStatusId,
      }),
    },
    ownerUpdates: ownerUpdateRows,
    photos: photoRows.filter(isImage).map((photo) => {
      const resolvedPhotoDate = photoDate({
        capturedAt: photo.capturedAt,
        logDate: photo.logDate,
        createdAt: photo.createdAt,
      })
      const schedulePhase = photo.schedulePhaseOverride?.trim() ?? ""

      return {
        id: photo.id,
        fileName: photo.fileName,
        driveFileId: null,
        thumbnailUrl: projectAudiencePhotoUrl(projectId, photo.id, audience),
        caption: photo.caption,
        capturedAt: photo.capturedAt,
        photoDate: resolvedPhotoDate,
        schedulePhase,
        schedulePhaseConfidence: schedulePhase.length > 0 ? 100 : 0,
        schedulePhaseReason:
          schedulePhase.length > 0
            ? "Phase was selected during upload or review."
            : "No phase assigned.",
      }
    }),
    scheduleItems: audienceScheduleItems,
    operations: audienceOperations,
    rfis: rfiRows,
    rfqs: audienceRfqs,
    messageChannels: messageChannelRows,
    contacts: visibleContactRows,
  }
}
