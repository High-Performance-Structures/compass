"use server"

import { and, asc, desc, eq, gte, or } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  ownerProjectUpdates,
  projectContacts,
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { channels } from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectAudience = "owner" | "sub_vendor"

export type AudiencePhoto = {
  readonly id: string
  readonly fileName: string
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly sourceSystem: string
  readonly photoKind: string
  readonly publicShareable: boolean
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
  readonly projectOptions: readonly AudienceProjectOption[]
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly address: string | null
    readonly clientName: string | null
    readonly projectManager: string | null
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
  projectId: string
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
}> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return { db, organizationId: orgId }
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

export async function getProjectAudiencePreview(
  projectId: string,
  audience: ProjectAudience
): Promise<ProjectAudiencePreview> {
  const { db, organizationId } = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      projectManager: projects.projectManager,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error("Project not found")
  }

  const projectOptions = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      status: projects.status,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.projectNumber), asc(projects.name))

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
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      mimeType: dailyLogPhotos.mimeType,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      sourceSystem: dailyLogPhotos.sourceSystem,
      photoKind: dailyLogPhotos.photoKind,
      publicShareable: dailyLogPhotos.publicShareable,
    })
    .from(dailyLogPhotos)
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
    })
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, today)
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(audience === "owner" ? 5 : 10)

  const contactRows = await db
    .select({
      id: projectContacts.id,
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

  const messageChannelRows = await db
    .select({
      id: channels.id,
      name: channels.name,
      description: channels.description,
      isPrivate: channels.isPrivate,
    })
    .from(channels)
    .where(
      and(
        eq(channels.organizationId, organizationId),
        eq(channels.projectId, projectId),
        eq(channels.type, "text")
      )
    )
    .orderBy(asc(channels.sortOrder), asc(channels.name))

  return {
    audience,
    projectOptions,
    project,
    ownerUpdates: ownerUpdateRows,
    photos: photoRows.filter(isImage).slice(0, 24).map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      driveUrl: photo.driveUrl,
      thumbnailUrl: photo.thumbnailUrl,
      caption: photo.caption,
      capturedAt: photo.capturedAt,
      sourceSystem: photo.sourceSystem,
      photoKind: photo.photoKind,
      publicShareable: photo.publicShareable,
    })),
    scheduleItems: scheduleRows,
    operations: operationRows
      .filter(
        (operation) =>
          isSubVendorOperation(operation.sourceRecordType) &&
          isActiveStatus(operation.status)
      )
      .slice(0, 10),
    rfis: rfiRows,
    messageChannels: messageChannelRows,
    contacts: contactRows,
  }
}
