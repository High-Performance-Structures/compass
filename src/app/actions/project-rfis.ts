"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  emailReplyThreads,
  inboundEmails,
  projectRfiAttachments,
  projectRfis,
  projects,
} from "@/db/schema"
import {
  notifyRfiCreated,
  notifyRfiUpdated,
} from "@/lib/notifications/events"
import { requireAuth } from "@/lib/auth"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { trackedMailtoHref } from "@/lib/email/mailto"
import {
  appendReplyTokenText,
  createEmailReplyThread,
} from "@/lib/email/reply-tracking"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { appendRfiCommunication } from "@/lib/rfis/communication"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  validRfiAudience,
  validRfiPriority,
  validRfiStatus,
} from "@/lib/rfis/status"

export type ProjectRfiAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageUrl: string | null
  readonly storageStatus: string
}

export type ProjectRfiInboundEmailItem = {
  readonly id: string
  readonly rfiId: string
  readonly from: string
  readonly subject: string
  readonly body: string
  readonly receivedAt: string
}

export type ProjectRfiItem = {
  readonly id: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly priority: string
  readonly audience: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly submittedAt: string
  readonly answeredAt: string | null
  readonly attachmentCount: number
  readonly attachments: readonly ProjectRfiAttachmentItem[]
}

export type ProjectRfiSummary = {
  readonly totalCount: number
  readonly openCount: number
  readonly highPriorityCount: number
  readonly subVendorVisibleCount: number
  readonly ownerVisibleCount: number
  readonly nextDue: ProjectRfiItem | null
  readonly items: readonly ProjectRfiItem[]
}

type ProjectRfiActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ProjectUpdateContext = {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly user: AuthUser
  readonly orgId: string
  readonly projectNumber: string | null
}

export type ProjectRfiAttachmentInput = {
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageProvider: string
  readonly storageId: string | null
  readonly storageUrl: string | null
}

export type CreateProjectRfiInput = {
  readonly subject: string
  readonly question: string
  readonly priority: string
  readonly audience: string
  readonly requesterName: string | null
  readonly assignedToName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
  readonly attachments: readonly ProjectRfiAttachmentInput[]
}

export type UpdateProjectRfiInput = {
  readonly answer: string | null
  readonly status: string
  readonly audience: string
}

export type ProjectRfiEmailDraftResult =
  | {
      readonly success: true
      readonly href: string
      readonly trackingAddress: string
    }
  | { readonly success: false; readonly error: string }

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "rfis", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

async function verifyProjectUpdateAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const context = await getProjectUpdateContext(projectId)
  return context.db
}

async function getProjectUpdateContext(
  projectId: string
): Promise<ProjectUpdateContext> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "rfis", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return { db, env, user, orgId, projectNumber: existing[0].projectNumber }
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function rfiNumberFor(
  projectNumber: string | null,
  existingCount: number,
  id: string
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = cleanText(projectNumber)
  if (prefix) return `${prefix}-RFI-${sequence}`

  const collisionSuffix = id.slice(0, 6).toUpperCase()
  return `RFI-${sequence}-${collisionSuffix}`
}

function isClosedRfiStatus(status: string): boolean {
  return ["complete", "closed", "void", "cancelled"].includes(
    status.toLowerCase()
  )
}

function isOpenRfi(item: ProjectRfiItem): boolean {
  return !isClosedRfiStatus(item.status)
}

function isSubVendorVisible(item: ProjectRfiItem): boolean {
  return item.audience === "sub_vendor" || item.audience === "public"
}

function isOwnerVisible(item: ProjectRfiItem): boolean {
  return item.audience === "owner" || item.audience === "public"
}

function isMissingAttachmentTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("project_rfi_attachments") &&
    (message.includes("no such table") || message.includes("failed query"))
  )
}

function toRfiItem(
  row: typeof projectRfis.$inferSelect,
  attachments: readonly ProjectRfiAttachmentItem[]
): ProjectRfiItem {
  return {
    id: row.id,
    rfiNumber: row.rfiNumber,
    subject: row.subject,
    question: row.question,
    answer: row.answer,
    status: row.status,
    priority: row.priority,
    audience: row.audience,
    requesterName: row.requesterName,
    assignedToName: row.assignedToName,
    companyName: row.companyName,
    dueDate: row.dueDate,
    submittedAt: row.submittedAt,
    answeredAt: row.answeredAt,
    attachmentCount: attachments.length,
    attachments,
  }
}

export async function getProjectRfiSummary(
  projectId: string
): Promise<ProjectRfiSummary> {
  const db = await verifyProjectAccess(projectId)

  const rows = await db
    .select()
    .from(projectRfis)
    .where(eq(projectRfis.projectId, projectId))
    .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

  const items = rows.map((row) => toRfiItem(row, []))
  const openItems = items.filter(isOpenRfi)

  return {
    totalCount: items.length,
    openCount: openItems.length,
    highPriorityCount: openItems.filter((item) => item.priority === "high")
      .length,
    subVendorVisibleCount: items.filter(isSubVendorVisible).length,
    ownerVisibleCount: items.filter(isOwnerVisible).length,
    nextDue: openItems[0] ?? null,
    items: items.slice(0, 8),
  }
}

export async function getProjectRfis(
  projectId: string
): Promise<readonly ProjectRfiItem[]> {
  const db = await verifyProjectAccess(projectId)

  const rows = await db
    .select()
    .from(projectRfis)
    .where(eq(projectRfis.projectId, projectId))
    .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

  let attachmentRows: ReadonlyArray<ProjectRfiAttachmentItem & {
    readonly rfiId: string
  }> = []

  try {
    attachmentRows = await db
      .select({
        id: projectRfiAttachments.id,
        rfiId: projectRfiAttachments.rfiId,
        fileName: projectRfiAttachments.fileName,
        mimeType: projectRfiAttachments.mimeType,
        fileSize: projectRfiAttachments.fileSize,
        storageUrl: projectRfiAttachments.storageUrl,
        storageStatus: projectRfiAttachments.storageStatus,
      })
      .from(projectRfiAttachments)
      .where(eq(projectRfiAttachments.projectId, projectId))
  } catch (error) {
    if (!isMissingAttachmentTableError(error)) {
      throw error
    }
  }

  const attachmentsByRfi = new Map<string, ProjectRfiAttachmentItem[]>()
  for (const attachment of attachmentRows) {
    const existing = attachmentsByRfi.get(attachment.rfiId) ?? []
    attachmentsByRfi.set(attachment.rfiId, [
      ...existing,
      {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        storageUrl: attachment.storageUrl,
        storageStatus: attachment.storageStatus,
      },
    ])
  }

  return rows.map((row) => toRfiItem(row, attachmentsByRfi.get(row.id) ?? []))
}

export async function getProjectRfiInboundEmails(
  projectId: string
): Promise<readonly ProjectRfiInboundEmailItem[]> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "rfis", "read")
  if (!isInternalStaffRole(user.role)) return []
  const db = await verifyProjectAccess(projectId)
  const rows = await db
    .select({
      id: inboundEmails.id,
      rfiId: emailReplyThreads.sourceId,
      fromAddress: inboundEmails.fromAddress,
      fromName: inboundEmails.fromName,
      subject: inboundEmails.subject,
      textBody: inboundEmails.textBody,
      snippet: inboundEmails.snippet,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .innerJoin(
      emailReplyThreads,
      eq(emailReplyThreads.id, inboundEmails.replyThreadId)
    )
    .where(
      and(
        eq(inboundEmails.projectId, projectId),
        eq(inboundEmails.matchedStatus, "posted"),
        eq(emailReplyThreads.sourceType, "rfi")
      )
    )
    .orderBy(desc(inboundEmails.receivedAt))

  return rows.map((row) => ({
    id: row.id,
    rfiId: row.rfiId,
    from: row.fromName ?? row.fromAddress,
    subject: row.subject,
    body:
      row.textBody?.trim() || row.snippet?.trim() || "Email reply received.",
    receivedAt: row.receivedAt,
  }))
}

export async function createProjectRfi(
  projectId: string,
  input: CreateProjectRfiInput
): Promise<ProjectRfiActionResult> {
  try {
    const { db, user, orgId, projectNumber } =
      await getProjectUpdateContext(projectId)
    const rows = await db
      .select({ id: projectRfis.id })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, projectId))

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const priority = validRfiPriority(input.priority)
    const audience = validRfiAudience(input.audience)
    if (!priority) {
      return { success: false, error: "Please choose a valid RFI priority." }
    }
    if (!audience) {
      return { success: false, error: "Please choose a valid RFI audience." }
    }
    const inserted: typeof projectRfis.$inferInsert = {
      id,
      projectId,
      rfiNumber: rfiNumberFor(projectNumber, rows.length, id),
      subject: requireText(input.subject, "Subject"),
      question: requireText(input.question, "Question"),
      status: "new",
      priority,
      audience,
      requesterName: cleanText(input.requesterName),
      assignedToName: cleanText(input.assignedToName),
      companyName: cleanText(input.companyName),
      dueDate: cleanText(input.dueDate),
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(projectRfis).values(inserted)
    const attachmentRows = input.attachments.map((attachment) => ({
      id: crypto.randomUUID(),
      projectId,
      rfiId: id,
      fileName: requireText(attachment.fileName, "Attachment file name"),
      mimeType: cleanText(attachment.mimeType),
      fileSize: Math.max(0, Math.round(attachment.fileSize)),
      storageProvider: cleanText(attachment.storageProvider) ?? "google_drive",
      storageId: cleanText(attachment.storageId),
      storageUrl: cleanText(attachment.storageUrl),
      storageStatus: cleanText(attachment.storageId) ? "uploaded" : "pending",
      createdAt: now,
      updatedAt: now,
    }))

    if (attachmentRows.length > 0) {
      try {
        await db.insert(projectRfiAttachments).values(attachmentRows)
      } catch (error) {
        if (!isMissingAttachmentTableError(error)) {
          throw error
        }
      }
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath("/dashboard/rfis")
    revalidatePath("/dashboard/schedule")

    try {
      await notifyRfiCreated({
        organizationId: orgId,
        projectId,
        rfiId: id,
        rfiNumber: inserted.rfiNumber,
        subject: inserted.subject,
        assignedToName: inserted.assignedToName ?? null,
        createdBy: user,
      })
    } catch (notificationError) {
      console.error("[project-rfis] notification error", notificationError)
    }

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create RFI",
    }
  }
}

export async function updateProjectRfi(
  projectId: string,
  rfiId: string,
  input: UpdateProjectRfiInput
): Promise<ProjectRfiActionResult> {
  try {
    const { db, user, orgId } =
      await getProjectUpdateContext(projectId)
    const existing = await db
      .select({
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        answer: projectRfis.answer,
        answeredAt: projectRfis.answeredAt,
        requesterName: projectRfis.requesterName,
        assignedToName: projectRfis.assignedToName,
      })
      .from(projectRfis)
      .where(
        and(
          eq(projectRfis.id, rfiId),
          eq(projectRfis.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) {
      return { success: false, error: "RFI not found" }
    }

    const now = new Date().toISOString()
    const response = cleanText(input.answer)
    const answer = response
      ? appendRfiCommunication({
          existing: existing.answer,
          message: response,
          author: user.displayName ?? user.email,
          occurredAt: now,
        })
      : existing.answer
    const requestedStatus = validRfiStatus(input.status)
    const audience = validRfiAudience(input.audience)
    if (!requestedStatus) {
      return { success: false, error: "Please choose a valid RFI status." }
    }
    if (!audience) {
      return { success: false, error: "Please choose a valid RFI audience." }
    }
    const status =
      response && requestedStatus === "new" ? "in_progress" : requestedStatus
    await db
      .update(projectRfis)
      .set({
        answer,
        status,
        audience,
        answeredAt:
          response || status === "complete"
            ? existing.answeredAt ?? now
            : existing.answeredAt,
        updatedAt: now,
      })
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)

    try {
      await notifyRfiUpdated({
        organizationId: orgId,
        projectId,
        rfiId,
        rfiNumber: existing.rfiNumber,
        subject: existing.subject,
        status,
        requesterName: existing.requesterName,
        assignedToName: existing.assignedToName,
        updatedBy: user,
      })
    } catch (notificationError) {
      console.error("[project-rfis] update notification error", notificationError)
    }

    return { success: true, id: rfiId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update RFI",
    }
  }
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function appOrigin(env: unknown): string {
  if (typeof env === "object" && env !== null) {
    const value = Reflect.get(env, "NEXT_PUBLIC_APP_URL")
    if (typeof value === "string" && value.trim()) return value.replace(/\/$/, "")
  }
  return "https://compass.openrangeconstruction.ltd"
}

export async function createProjectRfiEmailDraft(
  projectId: string,
  rfiId: string,
  recipientEmails: readonly string[]
): Promise<ProjectRfiEmailDraftResult> {
  try {
    const { db, env, user, orgId, projectNumber } =
      await getProjectUpdateContext(projectId)
    const to = Array.from(
      new Set(recipientEmails.map((email) => email.trim().toLowerCase()))
    ).filter(validEmail)
    if (to.length === 0) {
      return { success: false, error: "Choose at least one email recipient." }
    }
    if (to.length > 20) {
      return { success: false, error: "Choose no more than 20 recipients." }
    }

    const rfi = await db
      .select({
        id: projectRfis.id,
        rfiNumber: projectRfis.rfiNumber,
        subject: projectRfis.subject,
        question: projectRfis.question,
      })
      .from(projectRfis)
      .where(
        and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId))
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!rfi) return { success: false, error: "RFI not found." }

    const subject = `[${rfi.rfiNumber}] ${rfi.subject}`
    const thread = await createEmailReplyThread({
      env,
      db,
      organizationId: orgId,
      projectId,
      sourceType: "rfi",
      sourceId: rfi.id,
      sourceNumber: rfi.rfiNumber,
      subject,
      createdBy: user.id,
    })
    const body = appendReplyTokenText({
      token: thread.token,
      body: [
        `${projectNumber ?? "Project"} RFI ${rfi.rfiNumber}`,
        rfi.subject,
        "",
        rfi.question,
        "",
        `Open in Compass: ${appOrigin(env)}/dashboard/projects/${encodeURIComponent(projectId)}/rfis?item=${encodeURIComponent(rfi.id)}`,
        "",
        "Please keep Compass in CC (or use Reply All) so the response stays attached to this RFI and the project conversation.",
      ].join("\n"),
    })

    return {
      success: true,
      href: trackedMailtoHref({
        to,
        cc: thread.replyToAddress,
        subject,
        body,
      }),
      trackingAddress: thread.replyToAddress,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to prepare RFI email.",
    }
  }
}

export async function deleteProjectRfi(
  projectId: string,
  rfiId: string
): Promise<ProjectRfiActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId)
    const [existing] = await db
      .select({ id: projectRfis.id })
      .from(projectRfis)
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "RFI not found." }
    }

    try {
      await db
        .delete(projectRfiAttachments)
        .where(
          and(
            eq(projectRfiAttachments.rfiId, rfiId),
            eq(projectRfiAttachments.projectId, projectId)
          )
        )
    } catch (error) {
      if (!isMissingAttachmentTableError(error)) {
        throw error
      }
    }

    await db
      .delete(projectRfis)
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)
    revalidatePath("/dashboard/rfis")
    revalidatePath("/dashboard/schedule")

    return { success: true, id: rfiId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete RFI",
    }
  }
}
