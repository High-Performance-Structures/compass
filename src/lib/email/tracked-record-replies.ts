import "server-only"

import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { emailReplyThreads, projectOperations, projectRfis } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { stripHtml, type InboundCandidate } from "@/lib/email/gmail-message-parser"
import {
  emailReplyPreview,
  isTrackedRecordKind,
  trackedRecordHref,
  trackedRecordLabel,
  trackedRecordReplyEventType,
  type TrackedRecordKind,
} from "@/lib/email/tracked-record-email"
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
    action: `${kind}_email_reply_received`,
    entityType: kind === "rfi" ? "project_rfi" : "project_operation",
    entityId: replyThread.sourceId,
    summary: `${sender} replied by email to ${number}.`,
    metadata: {
      from: candidate.fromAddress,
      attachments: candidate.attachments.length,
    },
    createdAt: candidate.receivedAt,
  })

  try {
    const title = await recordTitle(db, kind, projectId, replyThread.sourceId)
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
