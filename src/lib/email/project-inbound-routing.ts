import "server-only"

import { and, eq, inArray, or, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  dailyLogs,
  notificationPreferences,
  organizationMembers,
  projectContacts,
  projectChangeOrderHistory,
  projectChangeOrders,
  projectOperations,
  projectRfis,
  projectVideos,
  projects,
  users,
} from "@/db/schema"
import {
  stripHtml,
  type InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import { matchInboundProject } from "@/lib/email/inbound-routing"
import {
  projectEmailDestination,
  projectEmailTitle,
  projectIdFromInboundAddress,
  type ProjectEmailDestination,
} from "@/lib/email/project-address"
import {
  sameTrustedInternalEmailMailbox,
  trustedInternalEmailDomains,
} from "@/lib/email/internal-email-alias"
import { storeDailyLogEmailAttachments } from "@/lib/email/project-email-attachments"
import { storeProjectVideoAttachment } from "@/lib/email/project-video-attachments"
import { projectDepartment } from "@/lib/project-branding"
import { youtubeChannelForDepartment } from "@/lib/videos/channel-routing"
import {
  isYoutubeApiAuditApproved,
  youtubePrivacyForAudience,
} from "@/lib/videos/youtube-audit"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"

type Db = ReturnType<typeof getDb>

export type ProjectInboundSource = {
  readonly kind: "email" | "goto_sms"
  readonly idPrefix: "email" | "sms"
  readonly sourceSystem: "email" | "goto_sms"
  readonly label: "Email" | "Text message"
}

const EMAIL_SOURCE: ProjectInboundSource = {
  kind: "email",
  idPrefix: "email",
  sourceSystem: "email",
  label: "Email",
}

export type ProjectInboundRouteResult =
  | { readonly kind: "not_project_email" }
  | { readonly kind: "other_organization" }
  | {
      readonly kind: "needs_review"
      readonly projectId: string | null
    }
  | {
      readonly kind: "routed"
      readonly projectId: string
      readonly entityId: string
      readonly matchedStatus:
        | "routed_rfi"
        | "routed_todo"
        | "routed_daily_log"
        | "routed_rfq"
        | "routed_change_order"
        | "routed_video"
    }

function candidateBody(candidate: InboundCandidate): string {
  const body = (
    candidate.textBody?.trim() ||
    (candidate.htmlBody ? stripHtml(candidate.htmlBody) : "") ||
    candidate.snippet?.trim() ||
    "(No message body.)"
  )
  if (candidate.attachments.length === 0) return body

  const attachmentLabels = new Set(
    candidate.attachments.map((attachment) => `[${attachment.fileName}]`)
  )
  return body
    .split("\n")
    .filter((line) => !attachmentLabels.has(line.trim()))
    .join("\n")
    .trim()
}

function senderLabel(candidate: InboundCandidate): string {
  return candidate.fromName?.trim() || candidate.fromAddress
}

function inboundActor(
  candidate: InboundCandidate,
  source: ProjectInboundSource
): {
  readonly id: null
  readonly email: string
  readonly displayName: string | null
  readonly firstName: null
  readonly lastName: null
  readonly role: string
} {
  return {
    id: null,
    email: candidate.fromAddress,
    displayName: candidate.fromName,
    firstName: null,
    lastName: null,
    role: source.kind === "email" ? "project_email" : "project_sms",
  }
}

function destinationLabel(destination: ProjectEmailDestination): string {
  if (destination === "rfi") return "RFI"
  if (destination === "rfq") return "RFQ draft"
  if (destination === "change_order") return "change-order draft"
  if (destination === "delivery") return "delivery to-do"
  if (destination === "todo") return "to-do"
  if (destination === "video") return "video review"
  return "daily log"
}

function destinationEntityType(destination: ProjectEmailDestination): string {
  if (destination === "rfi") return "rfi"
  if (destination === "rfq") return "rfq"
  if (destination === "change_order") return "change_order"
  if (destination === "daily_log") return "daily_log"
  if (destination === "video") return "project_video"
  return "todo"
}

async function senderCanEmailProject(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly senderEmail: string
}): Promise<boolean> {
  const email = input.senderEmail.trim().toLowerCase()
  if (email.length === 0) return false

  const [contact] = await input.db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.active, true),
        sql`lower(${projectContacts.email}) = ${email}`
      )
    )
    .limit(1)
  if (contact) return true

  const [member] = await input.db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.userId, users.id)
    )
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(users.isActive, true),
        or(
          sql`lower(${users.email}) = ${email}`,
          sql`lower(${users.googleEmail}) = ${email}`
        )
      )
    )
    .limit(1)
  if (member) return true

  // Staff commonly use parallel company-domain aliases (for example,
  // firstname@hps-colorado.com and firstname@openrangeconstruction.com).
  // Accept only matching mailboxes across explicitly trusted internal domains.
  const trustedDomains = trustedInternalEmailDomains(input.env)
  const activeMembers = await input.db
    .select({
      email: users.email,
      googleEmail: users.googleEmail,
    })
    .from(users)
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.userId, users.id)
    )
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(users.isActive, true)
      )
    )
  return activeMembers.some((activeMember) =>
    [activeMember.email, activeMember.googleEmail].some(
      (memberEmail) =>
        memberEmail !== null &&
        sameTrustedInternalEmailMailbox({
          senderEmail: email,
          memberEmail,
          trustedDomains,
        })
    )
  )
}

function rfiNumber(input: {
  readonly projectNumber: string | null
  readonly existingCount: number
  readonly id: string
}): string {
  const sequence = String(input.existingCount + 1).padStart(3, "0")
  const prefix = input.projectNumber?.trim()
  return prefix
    ? `${prefix}-RFI-${sequence}`
    : `RFI-${sequence}-${input.id.slice(-6).toUpperCase()}`
}

async function routeRfi(input: {
  readonly db: Db
  readonly projectId: string
  readonly projectNumber: string | null
  readonly candidate: InboundCandidate
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_rfi" }> {
  const id = `${input.source.idPrefix}-rfi-${input.candidate.gmailMessageId}`
  const existing = await input.db
    .select({ id: projectRfis.id })
    .from(projectRfis)
    .where(eq(projectRfis.projectId, input.projectId))
  const title =
    projectEmailTitle(input.candidate.subject) ||
    `Email from ${senderLabel(input.candidate)}`

  await input.db
    .insert(projectRfis)
    .values({
      id,
      projectId: input.projectId,
      sourceSystem: input.source.sourceSystem,
      sourceRecordId: input.candidate.gmailMessageId,
      rfiNumber: rfiNumber({
        projectNumber: input.projectNumber,
        existingCount: existing.length,
        id,
      }),
      subject: title,
      question: candidateBody(input.candidate),
      status: "new",
      priority: "normal",
      audience: "internal",
      requesterName: senderLabel(input.candidate),
      submittedAt: input.candidate.receivedAt,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: projectRfis.id })

  return { id, status: "routed_rfi" }
}

async function routeTodo(input: {
  readonly db: Db
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly delivery?: boolean
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_todo" }> {
  const id = `${input.source.idPrefix}-todo-${input.candidate.gmailMessageId}`
  const existing = await input.db
    .select({ id: projectOperations.id })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        inArray(projectOperations.sourceRecordType, [
          ...PROJECT_TODO_RECORD_TYPES,
        ])
      )
    )
  const baseTitle =
    projectEmailTitle(input.candidate.subject) ||
    `Email from ${senderLabel(input.candidate)}`
  const title = input.delivery ? `Delivery: ${baseTitle}` : baseTitle

  await input.db
    .insert(projectOperations)
    .values({
      id,
      projectId: input.projectId,
      sourceSystem: input.source.sourceSystem,
      sourceRecordType: "staff_task",
      sourceRecordId: input.candidate.gmailMessageId,
      sourceRecordNumber: `TASK-${String(existing.length + 1).padStart(3, "0")}`,
      title,
      description: candidateBody(input.candidate),
      status: "open",
      priority: "normal",
      assigneeType: "internal",
      sageWriteStatus: "not_ready",
      syncDirection: "write",
      syncStatus: "needs_review",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: projectOperations.id })

  return { id, status: "routed_todo" }
}

async function routeRfq(input: {
  readonly db: Db
  readonly projectId: string
  readonly projectNumber: string | null
  readonly candidate: InboundCandidate
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_rfq" }> {
  const id = `${input.source.idPrefix}-rfq-${input.candidate.gmailMessageId}`
  const existing = await input.db
    .select({ id: projectOperations.id })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        eq(projectOperations.sourceRecordType, "rfq")
      )
    )
  const title =
    projectEmailTitle(input.candidate.subject) ||
    `RFQ from ${senderLabel(input.candidate)}`
  const prefix = input.projectNumber?.trim() || "PROJECT"

  await input.db
    .insert(projectOperations)
    .values({
      id,
      projectId: input.projectId,
      sourceSystem: input.source.sourceSystem,
      sourceRecordType: "rfq",
      sourceRecordId: input.candidate.gmailMessageId,
      sourceRecordNumber:
        `${prefix}-RFQ-${String(existing.length + 1).padStart(3, "0")}`,
      title,
      description: candidateBody(input.candidate),
      status: "draft",
      priority: "normal",
      assigneeType: "vendor",
      sageWriteStatus: "not_ready",
      syncDirection: "write",
      syncStatus: "needs_review",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: projectOperations.id })

  return { id, status: "routed_rfq" }
}

async function routeChangeOrder(input: {
  readonly db: Db
  readonly projectId: string
  readonly projectNumber: string | null
  readonly candidate: InboundCandidate
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_change_order" }> {
  const id = `${input.source.idPrefix}-change-order-${input.candidate.gmailMessageId}`
  const existing = await input.db
    .select({ id: projectChangeOrders.id })
    .from(projectChangeOrders)
    .where(eq(projectChangeOrders.projectId, input.projectId))
  const title =
    projectEmailTitle(input.candidate.subject) ||
    `Change request from ${senderLabel(input.candidate)}`
  const prefix = input.projectNumber?.trim() || "PROJECT"
  const changeOrderNumber =
    `${prefix}-CO-${String(existing.length + 1).padStart(3, "0")}`

  await input.db
    .insert(projectChangeOrders)
    .values({
      id,
      projectId: input.projectId,
      changeOrderNumber,
      title,
      scope: candidateBody(input.candidate),
      status: "draft",
      audience: "internal",
      // Email-created requests enter as internal drafts until staff confirms
      // the sender's owner/sub role and chooses an external audience.
      requesterType: "internal",
      requesterName: senderLabel(input.candidate),
      sourceType: `${input.source.sourceSystem}_request`,
      sourceRecordId: input.candidate.gmailMessageId,
      internalNotes:
        `Created from a project ${input.source.label.toLowerCase()}; review before submitting.`,
      foxitStatus: "not_started",
      sageStatus: "not_ready",
      createdBy: null,
      submittedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: projectChangeOrders.id })

  await input.db
    .insert(projectChangeOrderHistory)
    .values({
      id: `${input.source.idPrefix}-change-order-history-${input.candidate.gmailMessageId}`,
      projectId: input.projectId,
      changeOrderId: id,
      eventType: "created",
      fromStatus: null,
      toStatus: "draft",
      actorUserId: null,
      actorName: senderLabel(input.candidate),
      actorRole: "internal",
      note: `Created from a project ${input.source.label.toLowerCase()} for staff review.`,
      metadataJson: JSON.stringify({
        source: input.source.sourceSystem,
        gmailMessageId: input.candidate.gmailMessageId,
      }),
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: projectChangeOrderHistory.id })

  return { id, status: "routed_change_order" }
}

async function routeDailyLog(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_daily_log" }> {
  const id = `${input.source.idPrefix}-daily-log-${input.candidate.gmailMessageId}`
  const title = projectEmailTitle(input.candidate.subject)
  const sourceNote = [
    `${input.source.label} from ${senderLabel(input.candidate)} <${input.candidate.fromAddress}>`,
    title.length > 0 ? `Subject: ${title}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")

  await input.db
    .insert(dailyLogs)
    .values({
      id,
      projectId: input.projectId,
      authorId: null,
      sourceSystem: input.source.sourceSystem,
      sourceExternalId: input.candidate.gmailMessageId,
      logDate: input.candidate.receivedAt.slice(0, 10),
      workCompleted: candidateBody(input.candidate),
      notes: sourceNote,
      isClientVisible: false,
      reviewStatus: "needs_review",
      syncStatus: "pending",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: dailyLogs.id })

  await storeDailyLogEmailAttachments({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    dailyLogId: id,
    candidate: input.candidate,
    now: input.now,
    sourceSystem: input.source.sourceSystem,
    idPrefix: input.source.idPrefix,
  })

  return { id, status: "routed_daily_log" }
}

function isVideoAttachment(attachment: InboundCandidate["attachments"][number]): boolean {
  return (
    attachment.mimeType.startsWith("video/") ||
    /\.(?:3gp|m4v|mov|mp4|webm)$/i.test(attachment.fileName)
  )
}

async function routeVideo(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly projectNumber: string | null
  readonly candidate: InboundCandidate
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{ readonly id: string; readonly status: "routed_video" }> {
  const attachment = input.candidate.attachments.find(isVideoAttachment)
  if (!attachment) {
    throw new Error("A [Video] message must include a video attachment.")
  }
  const sourceExternalId =
    `${input.candidate.gmailMessageId}:` +
    (attachment.attachmentId ?? attachment.fileName)
  const [existing] = await input.db
    .select({ id: projectVideos.id })
    .from(projectVideos)
    .where(
      and(
        eq(projectVideos.sourceSystem, input.source.sourceSystem),
        eq(projectVideos.sourceExternalId, sourceExternalId)
      )
    )
    .limit(1)
  if (existing) return { id: existing.id, status: "routed_video" }

  const stored = await storeProjectVideoAttachment({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    attachment,
  })
  const department = projectDepartment({
    projectId: input.projectId,
    projectNumber: input.projectNumber,
  })
  const id = `${input.source.idPrefix}-video-${input.candidate.gmailMessageId}`
  const dailyLogId =
    `${input.source.idPrefix}-video-log-${input.candidate.gmailMessageId}`
  const title =
    projectEmailTitle(input.candidate.subject) ||
    attachment.fileName.replace(/\.[^.]+$/, "") ||
    "Project video"
  const videoInsert = input.db.insert(projectVideos).values({
    id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    title,
    description: candidateBody(input.candidate),
    department,
    youtubeChannelKey: youtubeChannelForDepartment(department),
    compassAudience: "staff",
    youtubePrivacy: youtubePrivacyForAudience({
      audience: "staff",
      auditApproved: isYoutubeApiAuditApproved(input.env),
    }),
    publishStatus: "pending_review",
    sourceSystem: input.source.sourceSystem,
    sourceExternalId,
    sourceFileName: stored.fileName,
    sourceMimeType: stored.mimeType,
    sourceFileSize: stored.fileSize,
    driveFileId: stored.driveFileId,
    driveUrl: stored.driveUrl,
    linkedEntityType: "daily_log",
    linkedEntityId: dailyLogId,
    youtubeVideoId: null,
    youtubeUrl: null,
    youtubeUploadSessionUrl: null,
    uploadError: null,
    submittedByName: senderLabel(input.candidate),
    submittedByEmail: input.candidate.fromAddress,
    reviewedBy: null,
    reviewedAt: null,
    publishedAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing({
    target: [projectVideos.sourceSystem, projectVideos.sourceExternalId],
  })

  const dailyLogInsert = input.db
    .insert(dailyLogs)
    .values({
      id: dailyLogId,
      projectId: input.projectId,
      authorId: null,
      sourceSystem: input.source.sourceSystem,
      sourceExternalId: `${input.candidate.gmailMessageId}:video`,
      logDate: input.candidate.receivedAt.slice(0, 10),
      workCompleted: title,
      notes:
        `Video submitted by ${senderLabel(input.candidate)} for staff review. ` +
        "The share link will appear here after publication.",
      isClientVisible: false,
      reviewStatus: "needs_review",
      syncStatus: "pending",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: dailyLogs.id })

  await input.db.batch([videoInsert, dailyLogInsert])

  return { id, status: "routed_video" }
}

async function routeDestination(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly projectNumber: string | null
  readonly candidate: InboundCandidate
  readonly destination: ProjectEmailDestination
  readonly now: string
  readonly source: ProjectInboundSource
}): Promise<{
  readonly id: string
  readonly status:
    | "routed_rfi"
    | "routed_todo"
    | "routed_daily_log"
    | "routed_rfq"
    | "routed_change_order"
    | "routed_video"
}> {
  if (input.destination === "rfi") return routeRfi(input)
  if (input.destination === "rfq") return routeRfq(input)
  if (input.destination === "change_order") return routeChangeOrder(input)
  if (input.destination === "todo") return routeTodo(input)
  if (input.destination === "delivery") {
    return routeTodo({ ...input, delivery: true })
  }
  if (input.destination === "video") return routeVideo(input)
  return routeDailyLog(input)
}

async function routeVerifiedProjectInboundMessage(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly source: ProjectInboundSource
}): Promise<ProjectInboundRouteResult> {
  const projectId = input.projectId
  const [project] = await input.db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project) return { kind: "needs_review", projectId: null }
  if (project.organizationId !== input.organizationId) {
    return { kind: "other_organization" }
  }

  const destination = projectEmailDestination(input.candidate.subject)
  if (!destination) {
    await recordActivityEvent({
      db: input.db,
      id: `project-${input.source.idPrefix}-review-${input.candidate.gmailMessageId}`,
      organizationId: input.organizationId,
      projectId,
      actor: inboundActor(input.candidate, input.source),
      category: input.source.kind === "email" ? "email" : "conversation",
      action: `project_${input.source.sourceSystem}.needs_review`,
      entityType: `project_${input.source.sourceSystem}`,
      entityId: input.candidate.gmailMessageId,
      summary: `Project ${input.source.label.toLowerCase()} from ${senderLabel(input.candidate)} is awaiting routing review.`,
      metadata: {
        senderAuthorized: true,
        subjectTagged: destination !== null,
      },
      createdAt: input.candidate.receivedAt,
    })
    return { kind: "needs_review", projectId }
  }

  const routed = await routeDestination({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId,
    projectNumber: project.projectNumber,
    candidate: input.candidate,
    destination,
    now: new Date().toISOString(),
    source: input.source,
  })
  const title =
    projectEmailTitle(input.candidate.subject) || input.candidate.subject
  await recordActivityEvent({
    db: input.db,
    id: `project-${input.source.idPrefix}-routed-${input.candidate.gmailMessageId}`,
    organizationId: input.organizationId,
    projectId,
    actor: inboundActor(input.candidate, input.source),
    category: input.source.kind === "email" ? "email" : "conversation",
    action: `project_${input.source.sourceSystem}.routed`,
    entityType: destinationEntityType(destination),
    entityId: routed.id,
    summary:
      `Routed project ${input.source.label.toLowerCase()} from ${senderLabel(input.candidate)} to ` +
      `${destinationLabel(destination)}: “${title}”.` +
      (input.candidate.attachments.length > 0
        ? ` Stored ${input.candidate.attachments.length} attached ${
            input.candidate.attachments.length === 1 ? "file" : "files"
          }.`
        : ""),
    metadata: {
      destination,
      senderAuthorized: true,
      attachmentCount: input.candidate.attachments.length,
    },
    createdAt: input.candidate.receivedAt,
  })
  return {
    kind: "routed",
    projectId,
    entityId: routed.id,
    matchedStatus: routed.status,
  }
}

export async function routeProjectInboundEmail(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly candidate: InboundCandidate
}): Promise<ProjectInboundRouteResult> {
  let projectId = projectIdFromInboundAddress(input.candidate.toAddress)
  if (!projectId && projectEmailDestination(input.candidate.subject)) {
    const projectRows = await input.db
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
      })
      .from(projects)
      .where(eq(projects.organizationId, input.organizationId))
    projectId = matchInboundProject(input.candidate, projectRows)?.id ?? null
  }
  if (!projectId) return { kind: "not_project_email" }

  const senderAllowed = await senderCanEmailProject({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId,
    senderEmail: input.candidate.fromAddress,
  })
  if (!senderAllowed) {
    await recordActivityEvent({
      db: input.db,
      id: `project-email-review-${input.candidate.gmailMessageId}`,
      organizationId: input.organizationId,
      projectId,
      actor: inboundActor(input.candidate, EMAIL_SOURCE),
      category: "email",
      action: "project_email.needs_review",
      entityType: "project_email",
      entityId: input.candidate.gmailMessageId,
      summary: `Project email from an unrecognized sender (${input.candidate.fromAddress}) is awaiting review.`,
      metadata: { senderAuthorized: false, subjectTagged: false },
      createdAt: input.candidate.receivedAt,
    })
    return { kind: "needs_review", projectId }
  }

  return routeVerifiedProjectInboundMessage({
    ...input,
    projectId,
    source: EMAIL_SOURCE,
  })
}

function normalizedPhone(value: string): string {
  const digits = value.replace(/\D/g, "")
  if (digits.length === 10) return `1${digits}`
  return digits
}

async function verifiedSmsCandidate(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly senderPhone: string
  readonly candidate: InboundCandidate
}): Promise<InboundCandidate | null> {
  const senderPhone = normalizedPhone(input.senderPhone)
  const internal = await input.db
    .select({
      email: users.email,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: notificationPreferences.smsPhoneNumber,
    })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.userId, users.id)
    )
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(users.isActive, true),
        eq(notificationPreferences.smsConsentAccepted, true)
      )
    )
  const member = internal.find(
    (item) => item.phone !== null && normalizedPhone(item.phone) === senderPhone
  )
  if (member) {
    const name =
      member.displayName ??
      ([member.firstName, member.lastName].filter(Boolean).join(" ").trim() ||
        null)
    return { ...input.candidate, fromAddress: member.email, fromName: name }
  }

  const contacts = await input.db
    .select({
      email: projectContacts.email,
      displayName: projectContacts.displayName,
      phone: projectContacts.phone,
    })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.active, true)
      )
    )
  const contact = contacts.find(
    (item) => item.phone !== null && normalizedPhone(item.phone) === senderPhone
  )
  if (!contact) return null
  return {
    ...input.candidate,
    fromAddress: contact.email ?? `sms:${input.senderPhone}`,
    fromName: contact.displayName,
  }
}

export async function routeProjectInboundSms(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly senderPhone: string
  readonly candidate: InboundCandidate
}): Promise<ProjectInboundRouteResult> {
  const verifiedCandidate = await verifiedSmsCandidate(input)
  if (!verifiedCandidate) {
    await recordActivityEvent({
      db: input.db,
      id: `project-sms-review-${input.candidate.gmailMessageId}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      actor: inboundActor(input.candidate, {
        kind: "goto_sms",
        idPrefix: "sms",
        sourceSystem: "goto_sms",
        label: "Text message",
      }),
      category: "conversation",
      action: "project_goto_sms.needs_review",
      entityType: "project_goto_sms",
      entityId: input.candidate.gmailMessageId,
      summary: `Text message from unrecognized number ${input.senderPhone} is awaiting review.`,
      metadata: { senderAuthorized: false, subjectTagged: false },
      createdAt: input.candidate.receivedAt,
    })
    return { kind: "needs_review", projectId: input.projectId }
  }

  return routeVerifiedProjectInboundMessage({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
    projectId: input.projectId,
    candidate: verifiedCandidate,
    source: {
      kind: "goto_sms",
      idPrefix: "sms",
      sourceSystem: "goto_sms",
      label: "Text message",
    },
  })
}
