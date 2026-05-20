"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectRfiAttachments, projectRfis, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectRfiAttachmentItem = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly fileSize: number
  readonly storageUrl: string | null
  readonly storageStatus: string
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

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
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

  return db
}

async function verifyProjectUpdateAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
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

  return db
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

function rfiNumberFor(existingCount: number): string {
  return `RFI-${String(existingCount + 1).padStart(3, "0")}`
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

export async function createProjectRfi(
  projectId: string,
  input: CreateProjectRfiInput
): Promise<ProjectRfiActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId)
    const rows = await db
      .select({ id: projectRfis.id })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, projectId))

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const inserted: typeof projectRfis.$inferInsert = {
      id,
      projectId,
      rfiNumber: rfiNumberFor(rows.length),
      subject: requireText(input.subject, "Subject"),
      question: requireText(input.question, "Question"),
      status: "new",
      priority: input.priority,
      audience: input.audience,
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
    revalidatePath("/dashboard/schedule")

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
    const db = await verifyProjectUpdateAccess(projectId)
    const now = new Date().toISOString()
    const answer = cleanText(input.answer)
    const status = answer && input.status === "new" ? "in_progress" : input.status
    await db
      .update(projectRfis)
      .set({
        answer,
        status,
        audience: input.audience,
        answeredAt: status === "complete" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)

    return { success: true, id: rfiId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update RFI",
    }
  }
}
