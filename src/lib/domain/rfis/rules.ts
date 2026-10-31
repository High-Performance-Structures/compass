/**
 * Pure RFI rules: numbering, summary counts, status after a response, and
 * attachment rows. No database or network access (architecture standard,
 * section 1).
 */
import type { projectRfiAttachments, projectRfis } from "@/db/schema"
import { cleanText } from "@/lib/shared/guards"
import type { RfiVendorAssignment } from "@/lib/rfis/vendor-assignment"

import type {
  ProjectRfiAttachmentInput,
  ProjectRfiAttachmentItem,
  ProjectRfiItem,
  ProjectRfiSummary,
} from "./types"

type RfiRow = typeof projectRfis.$inferSelect
type RfiAttachmentInsert = typeof projectRfiAttachments.$inferInsert

export function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

/** `<project number>-RFI-001`, or `RFI-001-<id prefix>` without a project number. */
export function rfiNumberFor(projectNumber: string | null, existingCount: number, id: string): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = cleanText(projectNumber)
  if (prefix) return `${prefix}-RFI-${sequence}`

  const collisionSuffix = id.slice(0, 6).toUpperCase()
  return `RFI-${sequence}-${collisionSuffix}`
}

export function isClosedRfiStatus(status: string): boolean {
  return ["complete", "closed", "void", "cancelled"].includes(status.toLowerCase())
}

function isSubVendorVisible(item: ProjectRfiItem): boolean {
  return item.audience === "sub_vendor" || item.audience === "public"
}

function isOwnerVisible(item: ProjectRfiItem): boolean {
  return item.audience === "owner" || item.audience === "public"
}

/** Counts for the project overview; `items` arrive sorted by due date. */
export function summarizeRfis(items: readonly ProjectRfiItem[]): ProjectRfiSummary {
  const openItems = items.filter((item) => !isClosedRfiStatus(item.status))
  return {
    totalCount: items.length,
    openCount: openItems.length,
    highPriorityCount: openItems.filter((item) => item.priority === "high").length,
    subVendorVisibleCount: items.filter(isSubVendorVisible).length,
    ownerVisibleCount: items.filter(isOwnerVisible).length,
    nextDue: openItems[0] ?? null,
    items: items.slice(0, 8),
  }
}

/** A response on a new RFI moves it to in progress. */
export function rfiStatusAfterUpdate(hasResponse: boolean, requestedStatus: string): string {
  return hasResponse && requestedStatus === "new" ? "in_progress" : requestedStatus
}

/** The first response or completion stamps answeredAt; later edits keep it. */
export function rfiAnsweredAtAfterUpdate(input: {
  readonly hasResponse: boolean
  readonly status: string
  readonly existingAnsweredAt: string | null
  readonly now: string
}): string | null {
  return input.hasResponse || input.status === "complete"
    ? input.existingAnsweredAt ?? input.now
    : input.existingAnsweredAt
}

export function rfiAttachmentRows(input: {
  readonly projectId: string
  readonly rfiId: string
  readonly attachments: readonly ProjectRfiAttachmentInput[]
  readonly now: string
  readonly newId: () => string
}): RfiAttachmentInsert[] {
  return input.attachments.map((attachment) => ({
    id: input.newId(),
    projectId: input.projectId,
    rfiId: input.rfiId,
    fileName: requireText(attachment.fileName, "Attachment file name"),
    mimeType: cleanText(attachment.mimeType),
    fileSize: Math.max(0, Math.round(attachment.fileSize)),
    storageProvider: cleanText(attachment.storageProvider) ?? "google_drive",
    storageId: cleanText(attachment.storageId),
    storageUrl: cleanText(attachment.storageUrl),
    storageStatus: cleanText(attachment.storageId) ? "uploaded" : "pending",
    createdAt: input.now,
    updatedAt: input.now,
  }))
}

export function isMissingAttachmentTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("project_rfi_attachments") &&
    (message.includes("no such table") || message.includes("failed query"))
  )
}

export function groupAttachmentsByRfi(
  rows: ReadonlyArray<ProjectRfiAttachmentItem & { readonly rfiId: string }>
): Map<string, ProjectRfiAttachmentItem[]> {
  const byRfi = new Map<string, ProjectRfiAttachmentItem[]>()
  for (const attachment of rows) {
    const existing = byRfi.get(attachment.rfiId) ?? []
    byRfi.set(attachment.rfiId, [
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
  return byRfi
}

export function toRfiItem(
  row: RfiRow,
  attachments: readonly ProjectRfiAttachmentItem[],
  assignedVendor: RfiVendorAssignment | null = null
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
    assignedVendor,
  }
}
