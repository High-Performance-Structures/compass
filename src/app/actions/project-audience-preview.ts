"use server"

import { and, asc, desc, eq, gte, isNull, or } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
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
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"

export type ProjectAudience = "owner" | "sub_vendor"

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

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const project = await assertProjectAccess(db, user, projectId)
  if (!project.organizationId) {
    throw new Error("Project organization is missing")
  }

  return { db, organizationId: project.organizationId }
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

function phaseKeywords(phase: string): readonly string[] {
  const normalized = phase.toLowerCase()
  const terms = new Set(
    normalized
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2)
  )

  const keywordGroups: readonly {
    readonly match: string
    readonly keywords: readonly string[]
  }[] = [
    {
      match: "foundation",
      keywords: ["footing", "footer", "forms", "rebar", "pour", "concrete"],
    },
    {
      match: "excavat",
      keywords: ["dig", "soil", "grading", "trench", "utility", "backfill"],
    },
    {
      match: "floor",
      keywords: ["joist", "decking", "subfloor", "rim", "beam"],
    },
    {
      match: "framing",
      keywords: ["wall", "truss", "roof", "sheathing", "stud", "plate"],
    },
    {
      match: "mechanical",
      keywords: ["hvac", "duct", "furnace", "vent", "rough"],
    },
    {
      match: "electrical",
      keywords: ["wire", "panel", "outlet", "switch", "rough"],
    },
    {
      match: "plumbing",
      keywords: ["pipe", "drain", "water", "rough", "fixture"],
    },
    {
      match: "insulation",
      keywords: ["batts", "foam", "seal", "thermal"],
    },
    {
      match: "drywall",
      keywords: ["sheetrock", "tape", "mud", "texture"],
    },
    {
      match: "finish",
      keywords: ["cabinet", "trim", "paint", "flooring", "tile", "counter"],
    },
    {
      match: "inspection",
      keywords: ["inspect", "correction", "certificate", "co", "punch"],
    },
  ]

  for (const group of keywordGroups) {
    if (normalized.includes(group.match)) {
      for (const keyword of group.keywords) terms.add(keyword)
    }
  }

  return [...terms]
}

function keywordScore(phase: string, text: string): number {
  const normalizedText = text.toLowerCase()
  return phaseKeywords(phase).reduce(
    (score, keyword) =>
      normalizedText.includes(keyword.toLowerCase()) ? score + 1 : score,
    0
  )
}

function suggestPhaseForPhoto(
  photoDateValue: string,
  contextText: string,
  tasks: readonly {
    readonly phase: string
    readonly startDate: string
    readonly endDateCalculated: string
  }[]
): {
  readonly phase: string
  readonly confidence: number
  readonly reason: string
} {
  const matchingTask = tasks.find(
    (task) =>
      task.phase.trim().length > 0 &&
      task.startDate <= photoDateValue &&
      task.endDateCalculated >= photoDateValue
  )

  const phaseNames = [...new Set(tasks.map((task) => task.phase))]
  const scoredPhases = phaseNames
    .map((phase) => ({
      phase,
      score: keywordScore(phase, contextText),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
  const keywordMatch = scoredPhases[0]

  if (keywordMatch && matchingTask?.phase === keywordMatch.phase) {
    return {
      phase: keywordMatch.phase,
      confidence: 92,
      reason: "Schedule date and photo context both point to this phase.",
    }
  }

  if (keywordMatch && keywordMatch.score >= 2) {
    return {
      phase: keywordMatch.phase,
      confidence: 78,
      reason: "Photo caption, filename, or daily log text matches this phase.",
    }
  }

  if (matchingTask) {
    return {
      phase: matchingTask.phase,
      confidence: 64,
      reason: "Photo date falls inside this scheduled phase.",
    }
  }

  if (keywordMatch) {
    return {
      phase: keywordMatch.phase,
      confidence: 56,
      reason: "Photo context lightly matches this phase.",
    }
  }

  return {
    phase: "Unassigned phase",
    confidence: 0,
    reason: "No schedule date or photo context match was found.",
  }
}

function normalizeVisibleName(value: string | null): string {
  return value?.trim().toLowerCase() ?? ""
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
      status: projects.status,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error("Project not found")
  }

  const projectOptions: readonly AudienceProjectOption[] = [
    {
      id: project.id,
      name: project.name,
      projectNumber: project.projectNumber,
      status: project.status,
    },
  ]

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

  const phaseTaskRows = await db
    .select({
      phase: scheduleTasks.phase,
      startDate: scheduleTasks.startDate,
      endDateCalculated: scheduleTasks.endDateCalculated,
      sortOrder: scheduleTasks.sortOrder,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startDate))

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
        eq(channels.type, "text"),
        eq(channels.isPrivate, false),
        isNull(channels.archivedAt)
      )
    )
    .orderBy(asc(channels.sortOrder), asc(channels.name))

  const visibleContactNames = new Set(
    contactRows
      .flatMap((contact) => [
        normalizeVisibleName(contact.displayName),
        normalizeVisibleName(contact.companyName),
      ])
      .filter((value) => value.length > 0)
  )

  return {
    audience,
    projectOptions,
    project,
    ownerUpdates: ownerUpdateRows,
    photos: photoRows.filter(isImage).map((photo) => {
      const resolvedPhotoDate = photoDate({
        capturedAt: photo.capturedAt,
        logDate: photo.logDate,
        createdAt: photo.createdAt,
      })
      const suggestion =
        photo.schedulePhaseOverride &&
        photo.schedulePhaseOverride.trim().length > 0
          ? {
              phase: photo.schedulePhaseOverride,
              confidence: 100,
              reason: "Phase was manually assigned during photo review.",
            }
          : suggestPhaseForPhoto(
              resolvedPhotoDate,
              [
                photo.fileName,
                photo.caption,
                photo.photoKind,
                photo.logWorkCompleted,
                photo.logIssues,
                photo.logNotes,
              ]
                .filter((part) => part !== null && part.trim().length > 0)
                .join(" "),
              phaseTaskRows
            )

      return {
        id: photo.id,
        fileName: photo.fileName,
        driveFileId: photo.driveFileId,
        thumbnailUrl: photo.thumbnailUrl,
        caption: photo.caption,
        capturedAt: photo.capturedAt,
        photoDate: resolvedPhotoDate,
        schedulePhase: suggestion.phase,
        schedulePhaseConfidence: suggestion.confidence,
        schedulePhaseReason: suggestion.reason,
      }
    }),
    scheduleItems: scheduleRows,
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
    contacts: contactRows,
  }
}
