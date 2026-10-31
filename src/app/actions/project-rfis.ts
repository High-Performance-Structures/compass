"use server"

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  emailReplyThreads,
  inboundEmails,
  projectRfiAttachments,
  projectRfis,
} from "@/db/schema"
import { projectSourceRecordParticipants } from "@/db/schema-participants"
import { recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import { rfiReadContext, rfiWriteContext } from "@/lib/domain/rfis/access"
import {
  groupAttachmentsByRfi,
  isMissingAttachmentTableError,
  requireText,
  rfiAnsweredAtAfterUpdate,
  rfiAttachmentRows,
  rfiNumberFor,
  rfiStatusAfterUpdate,
  summarizeRfis,
  toRfiItem,
} from "@/lib/domain/rfis/rules"
import {
  rfiAttachmentsInsertStatement,
  rfiDeleteStatement,
  rfiInsertStatement,
  rfiUpdateStatement,
  updateRfi,
} from "@/lib/domain/rfis/store"
import type { CreateProjectRfiInput, ProjectRfiAttachmentItem, ProjectRfiInboundEmailItem, ProjectRfiItem, ProjectRfiSummary, UpdateProjectRfiInput } from "@/lib/domain/rfis/types"
import {
  notifyRfiCreated,
  notifyRfiUpdated,
} from "@/lib/notifications/events"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { requireProjectAudienceReadUser } from "@/lib/project-audience-request-server"
import { getProjectAudienceViewerContact } from "@/lib/project-audience-viewer-contact"
import { appendRfiCommunication } from "@/lib/rfis/communication"
import {
  validRfiAudience,
  validRfiPriority,
  validRfiStatus,
} from "@/lib/rfis/status"
import {
  listRfiVendorOptions,
  loadRfiVendorAssignments,
  resolveRfiVendorContact,
  rfiVendorAssignmentStatement,
  type RfiVendorAssignment,
  type RfiVendorOption,
} from "@/lib/rfis/vendor-assignment"
import { inJsonList, vendorVisibleRfiSourceIds } from "@/lib/rfis/vendor-visibility"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { deleteSourceRecordParticipantsStatement } from "@/lib/domain/documents/store"
import { isInternalStaffRole } from "@/lib/user-roles"

export type {
  CreateProjectRfiInput,
  ProjectRfiAttachmentInput,
  ProjectRfiInboundEmailItem,
  ProjectRfiItem,
  ProjectRfiSummary,
  UpdateProjectRfiInput,
} from "@/lib/domain/rfis/types"

type ProjectRfiActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

async function verifyProjectAccess(projectId: string): Promise<Db> {
  return (await rfiReadContext(projectId)).db
}

async function externalRfiVisibility(db: Db, projectId: string): Promise<ReturnType<typeof or>> {
  const user = await requireProjectAudienceReadUser(projectId)
  if (isInternalStaffRole(user.role)) return undefined
  const contact = await getProjectAudienceViewerContact(db, projectId, user)
  if (user.role === "subcontractor" || user.role === "supplier" || contact?.contactType === "subcontractor" || contact?.contactType === "supplier") {
    const ids = await vendorVisibleRfiSourceIds({ db, projectId, organizationId: requireOrg(user), viewerId: user.id, contact })
    return and(or(eq(projectRfis.audience, "sub_vendor"), eq(projectRfis.audience, "public")), or(inJsonList(projectRfis.id, ids), inJsonList(projectRfis.sourceRecordId, ids)))
  }
  if (user.role === "client" || user.role === "owner") return or(eq(projectRfis.audience, "owner"), eq(projectRfis.audience, "public"))
  return inArray(projectRfis.id, [])
}

async function assertRfiVendorAssignmentAccess(db: Db, user: AuthUser, projectId: string): Promise<void> {
  if (!isInternalStaffRole(user.role)) throw new Error("Only project staff can assign vendor access.")
  await assertProjectAccess(db, user, projectId)
}

export async function getProjectRfiSummary(
  projectId: string
): Promise<ProjectRfiSummary> {
  const db = await verifyProjectAccess(projectId)

  const rows = await db
    .select()
    .from(projectRfis)
    .where(and(eq(projectRfis.projectId, projectId), await externalRfiVisibility(db, projectId)))
    .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

  return summarizeRfis(rows.map((row) => toRfiItem(row, [])))
}

export async function getProjectRfis(
  projectId: string
): Promise<readonly ProjectRfiItem[]> {
  const db = await verifyProjectAccess(projectId)

  const rows = await db
    .select()
    .from(projectRfis)
    .where(and(eq(projectRfis.projectId, projectId), await externalRfiVisibility(db, projectId)))
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

  const attachmentsByRfi = groupAttachmentsByRfi(attachmentRows)

  const user = await requireProjectAudienceReadUser(projectId)
  const assignments = isInternalStaffRole(user.role)
    ? await loadRfiVendorAssignments(db, { organizationId: requireOrg(user), projectId })
    : new Map<string, RfiVendorAssignment>()

  return rows.map((row) => toRfiItem(row, attachmentsByRfi.get(row.id) ?? [], assignments.get(row.id) ?? null))
}

/** Active subcontractor/supplier contacts staff can assign an RFI to. */
export async function getProjectRfiVendorOptions(
  projectId: string
): Promise<readonly RfiVendorOption[]> {
  const user = await requireProjectAudienceReadUser(projectId)
  if (!isInternalStaffRole(user.role)) return []
  const db = await verifyProjectAccess(projectId)
  return listRfiVendorOptions(db, projectId)
}

export async function getProjectRfiInboundEmails(
  projectId: string
): Promise<readonly ProjectRfiInboundEmailItem[]> {
  const user = await requireProjectAudienceReadUser(projectId)
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
    const { db, user, orgId, projectNumber } = await rfiWriteContext(projectId)
    const vendorContactId = cleanText(input.assignedVendorContactId)
    if (vendorContactId) await assertRfiVendorAssignmentAccess(db, user, projectId)
    const existingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectRfis)
      .where(eq(projectRfis.projectId, projectId))
      .then((rows) => rows[0]?.count ?? 0)

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
    const vendorContact = vendorContactId
      ? await resolveRfiVendorContact(db, projectId, vendorContactId)
      : null
    if (vendorContactId && !vendorContact) {
      return { success: false, error: "Choose an active subcontractor or supplier on this project." }
    }
    const inserted: typeof projectRfis.$inferInsert = {
      id,
      projectId,
      rfiNumber: rfiNumberFor(projectNumber, existingCount, id),
      subject: requireText(input.subject, "Subject"),
      question: requireText(input.question, "Question"),
      status: "new",
      priority,
      audience,
      requesterName: cleanText(input.requesterName),
      assignedToName: cleanText(input.assignedToName) ?? vendorContact?.displayName ?? null,
      companyName: cleanText(input.companyName) ?? vendorContact?.companyName ?? null,
      dueDate: cleanText(input.dueDate),
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    const attachmentRows = rfiAttachmentRows({
      projectId,
      rfiId: id,
      attachments: input.attachments,
      now,
      newId: () => crypto.randomUUID(),
    })

    // D1 batches are atomic: the RFI, its vendor assignment, and its attachment
    // metadata either all commit or all roll back. A timeout/error must never
    // leave a partial RFI.
    const assignment = vendorContact
      ? [rfiVendorAssignmentStatement(db, { organizationId: orgId, projectId, rfiId: id, contact: vendorContact, now })]
      : []
    const attachmentInsert = attachmentRows.length > 0
      ? [rfiAttachmentsInsertStatement(db, attachmentRows)]
      : []
    await db.batch([rfiInsertStatement(db, inserted), ...assignment, ...attachmentInsert])

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
    const { db, user, orgId } = await rfiWriteContext(projectId)
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
    const status = rfiStatusAfterUpdate(response !== null, requestedStatus)
    await updateRfi(db, projectId, rfiId, {
      answer,
      status,
      audience,
      answeredAt: rfiAnsweredAtAfterUpdate({
        hasResponse: response !== null,
        status,
        existingAnsweredAt: existing.answeredAt,
        now,
      }),
      updatedAt: now,
    })

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
        mentionedUserIds: input.mentionedUserIds,
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

/**
 * Sets the vendor company that can see an RFI (any active contact at that
 * company), or clears it with `contactId: null`. Vendors never gain an RFI
 * from its audience flag or company label alone.
 */
export async function setProjectRfiVendorAssignment(
  projectId: string,
  rfiId: string,
  contactId: string | null
): Promise<ProjectRfiActionResult> {
  try {
    const { db, user, orgId } = await rfiWriteContext(projectId)
    await assertRfiVendorAssignmentAccess(db, user, projectId)
    const [existing] = await db
      .select({ id: projectRfis.id, rfiNumber: projectRfis.rfiNumber })
      .from(projectRfis)
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
      .limit(1)
    if (!existing) return { success: false, error: "RFI not found." }

    const contact = contactId ? await resolveRfiVendorContact(db, projectId, contactId) : null
    if (contactId && !contact) {
      return { success: false, error: "Choose an active subcontractor or supplier on this project." }
    }
    const now = new Date().toISOString()
    const assignment = rfiVendorAssignmentStatement(db, { organizationId: orgId, projectId, rfiId, contact, now })
    if (contact) {
      // Keep the visible assignment text in step with the stable assignment.
      await db.batch([
        assignment,
        rfiUpdateStatement(db, projectId, rfiId, {
          assignedToName: contact.displayName,
          companyName: contact.companyName,
          updatedAt: now,
        }),
      ])
    } else {
      await assignment
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "access",
      action: contact ? "rfi.vendor_assigned" : "rfi.vendor_cleared",
      entityType: "rfi",
      entityId: rfiId,
      summary: contact
        ? `Assigned ${existing.rfiNumber} to ${contact.companyName ?? contact.displayName}`
        : `Removed the vendor company from ${existing.rfiNumber}`,
      metadata: { contactId: contact?.id ?? null, vendorId: contact?.vendorId ?? null },
    })

    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)
    return { success: true, id: rfiId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update the RFI vendor",
    }
  }
}

export async function deleteProjectRfi(
  projectId: string,
  rfiId: string
): Promise<ProjectRfiActionResult> {
  try {
    const { db } = await rfiWriteContext(projectId)
    const [existing] = await db
      .select({ id: projectRfis.id, sourceRecordId: projectRfis.sourceRecordId })
      .from(projectRfis)
      .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "RFI not found." }
    }

    // Attachments cascade through their foreign key. Participant grants key on
    // the RFI id without a foreign key, so they are removed in the same batch.
    await db.batch([
      rfiDeleteStatement(db, projectId, rfiId),
      deleteSourceRecordParticipantsStatement(db, and(
        eq(projectSourceRecordParticipants.projectId, projectId),
        eq(projectSourceRecordParticipants.sourceRecordType, "rfi"),
        inJsonList(projectSourceRecordParticipants.sourceRecordId, existing.sourceRecordId ? [rfiId, existing.sourceRecordId] : [rfiId]),
      )),
    ])

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
