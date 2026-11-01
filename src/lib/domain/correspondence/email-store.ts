/**
 * The only code that inserts, updates, or deletes the email transport tables
 * behind project correspondence and tracked email: correspondence_email_threads,
 * correspondence_email_deliveries, correspondence_email_events,
 * email_reply_threads and inbound_emails (architecture standard, section 1).
 * No auth and no network here.
 */
import { and, eq, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { emailReplyThreads, inboundEmails } from "@/db/schema"
import {
  correspondenceEmailDeliveries,
  correspondenceEmailEvents,
  correspondenceEmailThreads,
} from "@/db/schema-correspondence-email"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
import type { Db } from "@/lib/server/action-context"

type DeliveryInsert = typeof correspondenceEmailDeliveries.$inferInsert
type DeliveryChanges = Partial<Omit<DeliveryInsert, "id">>
type EmailEventInsert = typeof correspondenceEmailEvents.$inferInsert
type ReplyThreadInsert = typeof emailReplyThreads.$inferInsert
type ReplyThreadChanges = Partial<Pick<ReplyThreadInsert, "channelId" | "lastInboundAt" | "updatedAt">>
type InboundEmailInsert = typeof inboundEmails.$inferInsert
type IdRows = ReadonlyArray<{ readonly id: string }>

// ---------------------------------------------------------------------------
// Correspondence email threads and deliveries
// ---------------------------------------------------------------------------

/** One reply thread per conversation; a concurrent creator wins quietly. */
export async function insertEmailThreadIfMissing(db: Db, row: typeof correspondenceEmailThreads.$inferInsert): Promise<void> {
  await db.insert(correspondenceEmailThreads).values(row).onConflictDoNothing()
}

/** Queues a delivery; returns no row when it was already queued. */
export async function insertEmailDelivery(db: Db, row: DeliveryInsert): Promise<IdRows> {
  return db.insert(correspondenceEmailDeliveries).values(row).onConflictDoNothing().returning({ id: correspondenceEmailDeliveries.id })
}

function deliveryMatch(deliveryId: string, whenStatus: string | undefined): SQL | undefined {
  return whenStatus === undefined
    ? eq(correspondenceEmailDeliveries.id, deliveryId)
    : and(eq(correspondenceEmailDeliveries.id, deliveryId), eq(correspondenceEmailDeliveries.status, whenStatus))
}

/**
 * Changes one delivery. With `whenStatus` the change applies only while the
 * delivery is still in that status (the release fence).
 */
export async function updateEmailDelivery(
  db: Db,
  deliveryId: string,
  changes: DeliveryChanges,
  whenStatus?: string
): Promise<void> {
  await db.update(correspondenceEmailDeliveries).set(changes).where(deliveryMatch(deliveryId, whenStatus))
}

/** Claims a delivery still in `whenStatus`; returns the row only if this caller won. */
export async function claimEmailDelivery(
  db: Db,
  deliveryId: string,
  changes: DeliveryChanges,
  whenStatus: string
): Promise<IdRows> {
  return db
    .update(correspondenceEmailDeliveries)
    .set(changes)
    .where(deliveryMatch(deliveryId, whenStatus))
    .returning({ id: correspondenceEmailDeliveries.id })
}

// ---------------------------------------------------------------------------
// Inbound email events
// ---------------------------------------------------------------------------

export function emailEventInsertStatement(db: Db, row: EmailEventInsert): BatchItem<"sqlite"> {
  return db.insert(correspondenceEmailEvents).values(row)
}

/** Records a provider event once; returns no row for a duplicate. */
export async function insertEmailEventOnce(db: Db, row: EmailEventInsert): Promise<IdRows> {
  return db.insert(correspondenceEmailEvents).values(row).onConflictDoNothing().returning({ id: correspondenceEmailEvents.id })
}

// ---------------------------------------------------------------------------
// Tracked reply threads (sendTrackedEmail) and the inbound mailbox log
// ---------------------------------------------------------------------------

export function replyThreadInsertStatement(db: Db, row: ReplyThreadInsert): BatchItem<"sqlite"> {
  return db.insert(emailReplyThreads).values(row)
}

export async function insertReplyThread(db: Db, row: ReplyThreadInsert): Promise<void> {
  await db.insert(emailReplyThreads).values(row)
}

export function replyThreadUpdateStatement(db: Db, replyThreadId: string, changes: ReplyThreadChanges): BatchItem<"sqlite"> {
  return db.update(emailReplyThreads).set(changes).where(eq(emailReplyThreads.id, replyThreadId))
}

export async function updateReplyThread(db: Db, replyThreadId: string, changes: ReplyThreadChanges): Promise<void> {
  await replyThreadUpdateStatement(db, replyThreadId, changes)
}

/**
 * Logs one Gmail message. A re-import of the same Gmail id refreshes only its
 * routing outcome (project, reply thread, status, posted record, import time).
 */
export async function upsertInboundEmail(db: Db, row: InboundEmailInsert): Promise<void> {
  await db
    .insert(inboundEmails)
    .values(row)
    .onConflictDoUpdate({
      target: inboundEmails.gmailMessageId,
      set: {
        projectId: row.projectId,
        replyThreadId: row.replyThreadId,
        matchedStatus: row.matchedStatus,
        postedMessageId: row.postedMessageId,
        importedAt: row.importedAt,
      },
    })
}

/** Staff posted a reviewed email to a project record. */
export async function markInboundEmailPosted(
  db: Db,
  emailId: string,
  posted: { readonly projectId: string; readonly postedMessageId: string }
): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ projectId: posted.projectId, matchedStatus: "posted", postedMessageId: posted.postedMessageId })
    .where(eq(inboundEmails.id, emailId))
}

/** Dismisses an email still waiting for review in this organization. */
export async function dismissInboundEmailForReview(db: Db, emailId: string, organizationId: string): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ matchedStatus: "dismissed" })
    .where(
      and(
        eq(inboundEmails.id, emailId),
        eq(inboundEmails.organizationId, organizationId),
        eq(inboundEmails.matchedStatus, "needs_review")
      )
    )
}

/** Points tracked email threads about a merged company at the kept one, so later replies land on it. */
export function companyMergeEmailThreadStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE email_reply_threads SET source_id = ?, updated_at = ?
    WHERE source_type = ? AND source_id = ? AND organization_id = ? AND ${guard.sql}`)
    .bind(move.destinationId, move.now, move.side, move.sourceId, move.organizationId, ...guard.binds)]
}
