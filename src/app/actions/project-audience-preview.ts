"use server"

import { and, asc, desc, eq, isNull, or } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  organizationMembers,
  ownerProjectUpdates,
  projectContacts,
  projectMembers,
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
  users,
} from "@/db/schema"
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
import { isVisibleAudienceTeamMember } from "@/lib/project-audience-team"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  isOwnerScheduleView,
  summarizeOwnerScheduleByPhase,
  type OwnerScheduleView,
  type OwnerScheduleVisibleItem,
} from "@/lib/schedule/owner-visibility"

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
  readonly status: string
  readonly phase: string
  readonly assignedTo: string | null
  readonly percentComplete: number
  readonly isMilestone: boolean
}

export type AudienceOperationItem = {
  readonly id: string
  readonly sourceRecordType: string
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
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
  }
  readonly projectOptions: readonly AudienceProjectOption[]
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly address: string | null
    readonly clientName: string | null
    readonly projectManager: string | null
    readonly ownerScheduleView: OwnerScheduleView
  }
  readonly ownerUpdates: readonly AudienceOwnerUpdate[]
  readonly photos: readonly AudiencePhoto[]
  readonly scheduleItems: readonly AudienceScheduleItem[]
  readonly operations: readonly AudienceOperationItem[]
  readonly rfis: readonly AudienceRfi[]
  readonly messageChannels: readonly AudienceMessageChannel[]
  readonly contacts: readonly AudienceContact[]
}

async function verifyProjectAccess(
  projectId: string,
  audience: ProjectAudience
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly viewerIsInternal: boolean
  readonly viewer: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly avatarUrl: string | null
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
    organizationId: project.organizationId,
    viewerIsInternal,
    viewer: {
      id: user.id,
      name: user.displayName ?? user.email.split("@")[0] ?? "Compass user",
      email: user.email,
      avatarUrl: user.avatarUrl,
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

function normalizeVisibleName(value: string | null): string {
  return value?.trim().toLowerCase() ?? ""
}

export async function getProjectAudiencePreview(
  projectId: string,
  audience: ProjectAudience
): Promise<ProjectAudiencePreview> {
  const { db, organizationId, viewerIsInternal, viewer } =
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

  const scheduleRows = await db
    .select({
      id: scheduleTasks.id,
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      status: scheduleTasks.status,
      phase: scheduleTasks.phase,
      assignedTo: scheduleTasks.assignedTo,
      percentComplete: scheduleTasks.percentComplete,
      isMilestone: scheduleTasks.isMilestone,
      workdays: scheduleTasks.workdays,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

  const contactRows = await db
    .select({
      id: projectContacts.id,
      userId: projectContacts.sourceEntityId,
      contactType: projectContacts.contactType,
      displayName: projectContacts.displayName,
      companyName: projectContacts.companyName,
      role: projectContacts.role,
      trade: projectContacts.trade,
      csiDivision: projectContacts.csiDivision,
      csiDivisionName: projectContacts.csiDivisionName,
      email: projectContacts.email,
      phone: projectContacts.phone,
      primaryContact: projectContacts.primaryContact,
    })
    .from(projectContacts)
    .where(
      audience === "owner"
        ? and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true),
            eq(projectContacts.ownerPortalVisible, true)
          )
        : and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true),
            eq(projectContacts.subVendorPortalVisible, true)
          )
    )
    .orderBy(asc(projectContacts.sortOrder), asc(projectContacts.displayName))

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
            startDate: projectOperations.startDate,
            dueDate: projectOperations.dueDate,
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
      : contactRows.find((contact) => contact.userId === viewer.id)?.id ?? null
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

  const internalTeamRows = await db
    .select({
      id: users.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      organizationRole: organizationMembers.role,
      projectRole: projectMembers.role,
      projectAssignedAt: projectMembers.assignedAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.userId, users.id),
        eq(projectMembers.projectId, projectId)
      )
    )
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(users.isActive, true)
      )
    )
    .orderBy(desc(projectMembers.assignedAt), asc(users.displayName))

  // Audience workspaces expose the authoritative internal team only. Internal
  // previewers receive the same directory that an owner or partner will see.
  const visibleContactRows = Array.from(
    new Map(
      internalTeamRows
        .filter((member) =>
          isVisibleAudienceTeamMember({
            userId: member.userId,
            email: member.email,
            role: member.organizationRole,
          })
        )
        .map((member) => [member.userId, member])
    ).values()
  ).map((member) => ({
    id: member.id,
    userId: member.userId,
    contactType: "internal",
    displayName: member.displayName ?? member.email,
    companyName: null,
    role: member.projectRole ?? member.organizationRole,
    trade: null,
    csiDivision: null,
    csiDivisionName: null,
    email: member.email,
    phone: null,
    primaryContact: false,
  }))
  const visibleContactNames = new Set(
    visibleContactRows
      .flatMap((contact) => [
        normalizeVisibleName(contact.displayName),
        normalizeVisibleName(contact.companyName),
      ])
      .filter((value) => value.length > 0)
  )
  const ownerScheduleView = isOwnerScheduleView(project.ownerScheduleView)
    ? project.ownerScheduleView
    : "items"
  const visibleScheduleItem = (
    item: (typeof scheduleRows)[number]
  ): OwnerScheduleVisibleItem => ({
    id: item.id,
    title: item.title,
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    phase: item.phase,
    assignedTo: item.assignedTo,
    percentComplete: item.percentComplete,
    isMilestone: item.isMilestone,
  })
  const ownerScheduleItems =
    ownerScheduleView === "phases"
      ? summarizeOwnerScheduleByPhase(scheduleRows)
      : scheduleRows.map(visibleScheduleItem)

  return {
    audience,
    viewerIsInternal,
    viewer,
    projectOptions,
    project: {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
      address: project.address,
      clientName: project.clientName,
      projectManager: project.projectManager,
      ownerScheduleView,
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
        driveFileId: photo.driveFileId,
        thumbnailUrl: photo.thumbnailUrl,
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
    scheduleItems:
      audience === "owner"
        ? ownerScheduleItems
        : scheduleRows.filter((item) =>
            visibleContactNames.has(normalizeVisibleName(item.assignedTo))
          ).map(visibleScheduleItem),
    operations: operationRows
      .filter(
        (operation) =>
          isSubVendorOperation(operation.sourceRecordType) &&
          isActiveStatus(operation.status) &&
          (visibleContactNames.has(normalizeVisibleName(operation.companyName)) ||
            visibleContactNames.has(normalizeVisibleName(operation.assigneeName)))
      )
      .slice(0, 10),
    rfis: rfiRows,
    messageChannels: messageChannelRows,
    contacts: visibleContactRows,
  }
}
