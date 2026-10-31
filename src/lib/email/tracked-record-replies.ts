import "server-only"

import { and, eq, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import { emailReplyThreads, projectContacts, projectOperations, projectRfis } from "@/db/schema"
import { insertProjectInteractionIfAbsent } from "@/lib/domain/crm/store"
import { recordActivityEvent } from "@/lib/activity-log"
import { stripHtml, type InboundCandidate } from "@/lib/email/gmail-message-parser"
import {
  emailReplyPreview,
  isJobLevelKind,
  isTrackedRecordKind,
  trackedRecordHref,
  trackedRecordLabel,
  trackedRecordReplyEventType,
  type TrackedRecordKind,
} from "@/lib/email/tracked-record-email"
import { clearOverdueFollowUpReminders } from "@/lib/notifications/clear-on-read"
import { notifyProjectStaffOfOutsideEvent } from "@/lib/notifications/events"

type Db = ReturnType<typeof getDb>

async function recordTitle(
  db: Db,
  kind: TrackedRecordKind,
  projectId: string,
  recordId: string
): Promise<string | null> {
  if (kind === "rfi") {
    return db
      .select({ subject: projectRfis.subject })
      .from(projectRfis)
      .where(and(eq(projectRfis.id, recordId), eq(projectRfis.projectId, projectId)))
      .limit(1)
      .then((rows) => rows[0]?.subject ?? null)
  }
  return db
    .select({ title: projectOperations.title })
    .from(projectOperations)
    .where(and(eq(projectOperations.id, recordId), eq(projectOperations.projectId, projectId)))
    .limit(1)
    .then((rows) => rows[0]?.title ?? null)
}

/**
 * A client's reply to a job email is client contact: it goes in the job's
 * interaction history and ends any overdue follow-up, like any inbound
 * client email. Replies from anyone else are not logged as client contact.
 */
async function recordClientReply(input: {
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly candidate: InboundCandidate
  readonly label: string
  readonly preview: string
}): Promise<void> {
  try {
    const contact = await input.db
      .select({ id: projectContacts.id })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, input.projectId),
          eq(projectContacts.contactType, "owner"),
          eq(projectContacts.active, true),
          sql`lower(${projectContacts.email}) = ${input.candidate.fromAddress.trim().toLowerCase()}`
        )
      )
      .get()
    if (!contact) return
    const sender = input.candidate.fromName?.trim() || input.candidate.fromAddress
    await insertProjectInteractionIfAbsent(input.db, {
      id: `project-interaction-reply-${input.candidate.gmailMessageId}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectContactId: contact.id,
      interactionType: "email",
      direction: "inbound",
      source: "email",
      qualifiesForClientTouch: true,
      summary: `Reply to ${input.label} from ${sender}${input.preview ? `: ${input.preview}` : ""}`.slice(0, 1000),
      occurredAt: input.candidate.receivedAt,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
      createdAt: input.candidate.receivedAt,
      updatedAt: input.candidate.receivedAt,
      deletedAt: null,
    })
    await clearOverdueFollowUpReminders(input.db, [input.projectId])
  } catch (error) {
    console.error("[tracked-record-replies] client reply log failed", error)
  }
}

/**
 * Runs after an outside reply to an RFI, RFQ or purchase order email has been
 * posted to the project. The reply itself is already saved; telling people
 * about it must never undo that, so failures are only logged.
 */
export async function announceTrackedRecordReply(input: {
  readonly db: Db
  readonly replyThread: typeof emailReplyThreads.$inferSelect
  readonly candidate: InboundCandidate
}): Promise<void> {
  const { db, replyThread, candidate } = input
  const kind = replyThread.sourceType
  const projectId = replyThread.projectId
  if (!projectId || !isTrackedRecordKind(kind)) return

  const label = trackedRecordLabel(kind)
  const number = replyThread.sourceNumber ?? label
  const sender = candidate.fromName?.trim() || candidate.fromAddress
  const text =
    candidate.textBody?.trim() ||
    (candidate.htmlBody ? stripHtml(candidate.htmlBody).trim() : "") ||
    candidate.snippet?.trim() ||
    ""
  const preview = emailReplyPreview(text)
  const href = trackedRecordHref({ kind, projectId, recordId: replyThread.sourceId })
  const jobLevel = isJobLevelKind(kind)

  await recordActivityEvent({
    db,
    id: `tracked-reply-${candidate.gmailMessageId}`,
    organizationId: replyThread.organizationId,
    projectId,
    actor: {
      id: null,
      email: candidate.fromAddress,
      displayName: candidate.fromName,
      firstName: null,
      lastName: null,
      role: "email",
    },
    category: "email",
    action: jobLevel ? `${kind}_reply_received` : `${kind}_email_reply_received`,
    entityType: jobLevel ? "project" : kind === "rfi" ? "project_rfi" : "project_operation",
    entityId: replyThread.sourceId,
    summary: jobLevel
      ? `${sender} replied to the ${number} email "${replyThread.subject}".`
      : `${sender} replied by email to ${number}.`,
    metadata: {
      from: candidate.fromAddress,
      attachments: candidate.attachments.length,
    },
    createdAt: candidate.receivedAt,
  })

  if (jobLevel) {
    await recordClientReply({ db, organizationId: replyThread.organizationId, projectId, candidate, label: number, preview })
  }

  try {
    const title = jobLevel
      ? replyThread.subject
      : await recordTitle(db, kind, projectId, replyThread.sourceId)
    await notifyProjectStaffOfOutsideEvent({
      organizationId: replyThread.organizationId,
      projectId,
      eventType: trackedRecordReplyEventType(kind),
      sourceType: kind,
      sourceId: replyThread.sourceId,
      title: `${number}${title ? `: ${title}` : ""} - reply from ${sender}`,
      body: preview || `${sender} replied to the ${label} email.`,
      href,
      priority: "normal",
      ownerUserId: replyThread.createdBy,
    })
  } catch (error) {
    console.error("[tracked-record-replies] reply notification failed", error)
  }
}
