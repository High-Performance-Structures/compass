/**
 * The only code that inserts, updates, or deletes the project correspondence
 * tables: project_correspondence, correspondence_messages, _participants,
 * _recipients, _outbox, _revisions, _state, _write_guards, _drafts,
 * _composition_drafts, _saved_drafts and _attachments (architecture
 * standard, section 1). The email transport tables live in email-store.ts.
 * No auth here: callers resolve the correspondence context first.
 *
 * Functions named `...Statement` return an unexecuted statement so callers
 * can commit a message, its audience, and its write guard in one D1 batch.
 */
import { and, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  correspondence,
  correspondenceAttachments,
  correspondenceCompositionDrafts,
  correspondenceDrafts,
  correspondenceMessages,
  correspondenceOutbox,
  correspondenceParticipants,
  correspondenceRecipients,
  correspondenceRevisions,
  correspondenceSavedDrafts,
  correspondenceState,
  correspondenceWriteGuards,
} from "@/db/schema-correspondence"
import type { Db } from "@/lib/server/action-context"

import { JS_TRIM_CHARACTERS } from "./rules"

type InsertOptions = { readonly ignoreConflict?: boolean }
type ConversationInsert = typeof correspondence.$inferInsert
type MessageInsert = typeof correspondenceMessages.$inferInsert
type ParticipantInsert = typeof correspondenceParticipants.$inferInsert
type RecipientInsert = typeof correspondenceRecipients.$inferInsert
type OutboxInsert = typeof correspondenceOutbox.$inferInsert
type RevisionInsert = typeof correspondenceRevisions.$inferInsert
type AttachmentInsert = typeof correspondenceAttachments.$inferInsert
type SavedDraftInsert = typeof correspondenceSavedDrafts.$inferInsert
type SavedDraftChanges = Partial<Pick<SavedDraftInsert, "content" | "version" | "updatedAt" | "retiredAt">>
type StatePatch = Partial<Pick<typeof correspondenceState.$inferInsert, "saved" | "followUp" | "archived" | "shareReadReceipts">>

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

export function conversationInsertStatement(db: Db, row: ConversationInsert, options: InsertOptions = {}): BatchItem<"sqlite"> {
  const insert = db.insert(correspondence).values(row)
  return options.ignoreConflict ? insert.onConflictDoNothing() : insert
}

/** A new message reopens a closed conversation. */
export function reopenConversationStatement(db: Db, conversationId: string): BatchItem<"sqlite"> {
  return db.update(correspondence).set({ closed: false }).where(eq(correspondence.id, conversationId))
}

export async function setConversationClosed(db: Db, conversationId: string, closed: boolean): Promise<void> {
  await db.update(correspondence).set({ closed }).where(eq(correspondence.id, conversationId))
}

export function messageInsertStatement(db: Db, row: MessageInsert): BatchItem<"sqlite"> {
  return db.insert(correspondenceMessages).values(row)
}

/** Edit (new body) or retract (null) a message. */
export function messageRevisionStatement(db: Db, messageId: string, body: string | null, now: string): BatchItem<"sqlite"> {
  return db
    .update(correspondenceMessages)
    .set(body === null ? { retractedAt: now } : { body, editedAt: now })
    .where(eq(correspondenceMessages.id, messageId))
}

export function revisionInsertStatement(db: Db, row: RevisionInsert): BatchItem<"sqlite"> {
  return db.insert(correspondenceRevisions).values(row)
}

// ---------------------------------------------------------------------------
// Audience: participants, recipients, outbox
// ---------------------------------------------------------------------------

export function participantInsertStatement(db: Db, rows: readonly ParticipantInsert[], options: InsertOptions = {}): BatchItem<"sqlite"> {
  const insert = db.insert(correspondenceParticipants).values([...rows])
  return options.ignoreConflict ? insert.onConflictDoNothing() : insert
}

export function recipientInsertStatement(db: Db, rows: readonly RecipientInsert[]): BatchItem<"sqlite"> {
  return db.insert(correspondenceRecipients).values([...rows])
}

export function outboxInsertStatement(db: Db, rows: readonly OutboxInsert[]): BatchItem<"sqlite"> {
  return db.insert(correspondenceOutbox).values([...rows])
}

/** An edited or retracted message is unread again for everyone. */
export function resetMessageOpenedStatement(db: Db, messageId: string): BatchItem<"sqlite"> {
  return db.update(correspondenceRecipients).set({ openedAt: null }).where(eq(correspondenceRecipients.messageId, messageId))
}

/**
 * The viewer opened one message revision. Only the revision actually shown
 * (`editedAt`) counts, so a delayed read request cannot certify a later edit.
 */
export function markMessageOpenedStatement(
  db: Db,
  input: { readonly userId: string; readonly conversationId: string; readonly messageId: string; readonly editedAt: string | null; readonly now: string }
): BatchItem<"sqlite"> {
  return db.update(correspondenceRecipients).set({ openedAt: input.now }).where(and(
    eq(correspondenceRecipients.userId, input.userId), eq(correspondenceRecipients.messageId, input.messageId), isNull(correspondenceRecipients.openedAt),
    sql`EXISTS(SELECT 1 FROM correspondence_messages m JOIN correspondence_participants p ON p.conversation_id=m.conversation_id
          WHERE m.id=${input.messageId} AND m.conversation_id=${input.conversationId} AND m.retracted_at IS NULL
          AND p.user_id=${input.userId} AND p.revoked_at IS NULL
          AND ${input.editedAt === null ? sql`m.edited_at IS NULL` : sql`m.edited_at=${input.editedAt}`})`
  ))
}

/** Inbox "mark read": every message others sent the viewer in one conversation. */
export function markConversationReadStatement(
  db: Db,
  input: { readonly userId: string; readonly conversationId: string; readonly now: string }
): BatchItem<"sqlite"> {
  return db
    .update(correspondenceRecipients)
    .set({ openedAt: input.now })
    .where(
      and(
        eq(correspondenceRecipients.userId, input.userId),
        isNull(correspondenceRecipients.openedAt),
        eq(correspondenceRecipients.baseline, false),
        sql`EXISTS (SELECT 1 FROM correspondence_messages m JOIN correspondence_participants p ON p.conversation_id=m.conversation_id
            WHERE m.id=correspondence_recipients.message_id AND m.conversation_id=${input.conversationId}
            AND p.user_id=${input.userId} AND p.revoked_at IS NULL AND m.retracted_at IS NULL
            AND (m.author_user_id IS NULL OR m.author_user_id<>${input.userId})
            AND m.sent_at<=${input.now} AND (m.edited_at IS NULL OR m.edited_at<=${input.now}))`,
      ),
    )
}

// ---------------------------------------------------------------------------
// Per-person conversation state
// ---------------------------------------------------------------------------

/** Creates the viewer's state row or updates exactly the patched flags. */
export function upsertConversationStateStatement(db: Db, conversationId: string, userId: string, patch: StatePatch): BatchItem<"sqlite"> {
  return db
    .insert(correspondenceState)
    .values({ id: crypto.randomUUID(), conversationId, userId, ...patch })
    .onConflictDoUpdate({ target: [correspondenceState.conversationId, correspondenceState.userId], set: patch })
}

export async function upsertConversationState(db: Db, conversationId: string, userId: string, patch: StatePatch): Promise<void> {
  await upsertConversationStateStatement(db, conversationId, userId, patch)
}

// ---------------------------------------------------------------------------
// Write guards
// ---------------------------------------------------------------------------

/**
 * A guard row whose CHECK constraint aborts the whole D1 batch when `allowed`
 * evaluates to 0 (access or audience changed between preflight and write).
 */
export function writeGuardInsertStatement(db: Db, id: string, allowed: SQL): BatchItem<"sqlite"> {
  return db.insert(correspondenceWriteGuards).values({ id, allowed })
}

export function writeGuardDeleteStatement(db: Db, id: string): BatchItem<"sqlite"> {
  return db.delete(correspondenceWriteGuards).where(eq(correspondenceWriteGuards.id, id))
}

// ---------------------------------------------------------------------------
// Reply drafts and new-conversation drafts
// ---------------------------------------------------------------------------

/** Creates the first reply draft version; returns nothing when one exists. */
export async function insertReplyDraft(
  db: Db,
  row: typeof correspondenceDrafts.$inferInsert
): Promise<ReadonlyArray<{ readonly version: number }>> {
  return db.insert(correspondenceDrafts).values(row).onConflictDoNothing().returning({ version: correspondenceDrafts.version })
}

/** Saves a reply draft only while it is still at `expectedVersion`. */
export async function updateReplyDraft(
  db: Db,
  input: {
    readonly conversationId: string
    readonly userId: string
    readonly expectedVersion: number
    readonly body: string
    readonly attachmentIds: readonly string[]
    readonly version: number
    readonly updatedAt: string
  }
): Promise<ReadonlyArray<{ readonly version: number }>> {
  return db
    .update(correspondenceDrafts)
    .set({ body: input.body, attachmentIds: [...input.attachmentIds], version: input.version, updatedAt: input.updatedAt })
    .where(and(eq(correspondenceDrafts.conversationId, input.conversationId), eq(correspondenceDrafts.userId, input.userId), eq(correspondenceDrafts.version, input.expectedVersion)))
    .returning({ version: correspondenceDrafts.version })
}

/** Empties the reply draft when its text is exactly what was just sent. */
export function clearSentReplyDraftStatement(
  db: Db,
  input: { readonly conversationId: string; readonly userId: string; readonly sentBody: string; readonly now: string }
): BatchItem<"sqlite"> {
  return db.update(correspondenceDrafts).set({ body: "", attachmentIds: [], version: sql`${correspondenceDrafts.version} + 1`, updatedAt: input.now })
    .where(and(eq(correspondenceDrafts.conversationId, input.conversationId), eq(correspondenceDrafts.userId, input.userId), sql`trim(${correspondenceDrafts.body}, ${JS_TRIM_CHARACTERS})=${input.sentBody.trim()}`))
}

/** Empties the new-conversation draft when it matches what was just sent. */
export function clearSentCompositionDraftStatement(
  db: Db,
  input: {
    readonly organizationId: string
    readonly projectId: string
    readonly userId: string
    readonly sentBody: string
    readonly sentSubject: string
    readonly recipientUserIds: readonly string[]
    readonly now: string
  }
): BatchItem<"sqlite"> {
  return db.update(correspondenceCompositionDrafts).set({ body: "", subject: "", recipientUserIds: [], version: sql`${correspondenceCompositionDrafts.version} + 1`, updatedAt: input.now })
    .where(and(eq(correspondenceCompositionDrafts.organizationId, input.organizationId), eq(correspondenceCompositionDrafts.projectId, input.projectId), eq(correspondenceCompositionDrafts.userId, input.userId),
      sql`trim(${correspondenceCompositionDrafts.body}, ${JS_TRIM_CHARACTERS})=${input.sentBody.trim()}`, sql`trim(${correspondenceCompositionDrafts.subject}, ${JS_TRIM_CHARACTERS})=${input.sentSubject.trim()}`, eq(correspondenceCompositionDrafts.recipientUserIds, [...input.recipientUserIds])))
}

// ---------------------------------------------------------------------------
// Saved drafts (the Drafts list)
// ---------------------------------------------------------------------------

export type SavedDraftOwner = {
  readonly id: string
  readonly organizationId: string
  readonly projectId: string
  readonly userId: string
}

function ownedSavedDraft(owner: SavedDraftOwner): SQL[] {
  return [
    eq(correspondenceSavedDrafts.id, owner.id),
    eq(correspondenceSavedDrafts.organizationId, owner.organizationId),
    eq(correspondenceSavedDrafts.projectId, owner.projectId),
    eq(correspondenceSavedDrafts.userId, owner.userId),
  ]
}

export async function insertSavedDraft(db: Db, row: SavedDraftInsert): Promise<ReadonlyArray<typeof correspondenceSavedDrafts.$inferSelect>> {
  return db.insert(correspondenceSavedDrafts).values(row).onConflictDoNothing().returning()
}

/** Autosave: changes a live draft only at `expectedVersion`. */
export async function updateLiveSavedDraft(
  db: Db,
  owner: SavedDraftOwner,
  expectedVersion: number,
  changes: SavedDraftChanges
): Promise<ReadonlyArray<typeof correspondenceSavedDrafts.$inferSelect>> {
  return db
    .update(correspondenceSavedDrafts)
    .set(changes)
    .where(and(and(...ownedSavedDraft(owner), isNull(correspondenceSavedDrafts.retiredAt)), eq(correspondenceSavedDrafts.version, expectedVersion)))
    .returning()
}

/** Discard or restore a draft at `expectedVersion`. */
export async function setSavedDraftRetired(
  db: Db,
  owner: SavedDraftOwner,
  expectedVersion: number,
  changes: Pick<SavedDraftChanges, "retiredAt" | "version">
): Promise<ReadonlyArray<{ readonly version: number }>> {
  return db
    .update(correspondenceSavedDrafts)
    .set(changes)
    .where(and(...ownedSavedDraft(owner), eq(correspondenceSavedDrafts.version, expectedVersion)))
    .returning({ version: correspondenceSavedDrafts.version })
}

/**
 * Unlocks a draft reserved by a send request, only while `absent` (no
 * recorded send) still holds; returns the new version or nothing.
 */
export async function releaseSavedDraftRequest(
  db: Db,
  owner: SavedDraftOwner,
  input: { readonly version: number; readonly requestId: string; readonly kind: string; readonly absent: SQL }
): Promise<ReadonlyArray<{ readonly version: number }>> {
  return db.update(correspondenceSavedDrafts).set({ content: sql`json_set(${correspondenceSavedDrafts.content}, '$.requestId', NULL)`, version: input.version + 1 })
    .where(and(...ownedSavedDraft(owner), eq(correspondenceSavedDrafts.version, input.version), isNull(correspondenceSavedDrafts.retiredAt), sql`json_extract(content,'$.requestId')=${input.requestId}`, sql`json_extract(content,'$.kind')=${input.kind}`, input.absent)).returning({ version: correspondenceSavedDrafts.version })
}

/** A sent composition retires its saved draft in the send batch. */
export function retireSavedDraftStatement(db: Db, owner: SavedDraftOwner, version: number): BatchItem<"sqlite"> {
  return db.update(correspondenceSavedDrafts).set({ retiredAt: new Date().toISOString(), version: sql`${correspondenceSavedDrafts.version}+1` }).where(and(...ownedSavedDraft(owner), eq(correspondenceSavedDrafts.version, version), isNull(correspondenceSavedDrafts.retiredAt)))
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function insertAttachment(db: Db, row: AttachmentInsert): Promise<void> {
  await db.insert(correspondenceAttachments).values(row)
}

/** Binds an unsent, live upload to the message being saved. */
export function attachToMessageStatement(db: Db, attachmentId: string, messageId: string): BatchItem<"sqlite"> {
  return db.update(correspondenceAttachments).set({ messageId }).where(and(eq(correspondenceAttachments.id, attachmentId), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt)))
}

/** Retires the owner's unsent upload; returns null when it is not claimable. */
export async function retireUnsentAttachment(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly projectId: string; readonly ownerUserId: string; readonly retiredAt: string }
): Promise<{ readonly id: string } | null> {
  return db
    .update(correspondenceAttachments)
    .set({ retiredAt: input.retiredAt })
    .where(
      and(
        eq(correspondenceAttachments.id, input.id),
        eq(correspondenceAttachments.organizationId, input.organizationId),
        eq(correspondenceAttachments.projectId, input.projectId),
        eq(correspondenceAttachments.ownerUserId, input.ownerUserId),
        isNull(correspondenceAttachments.messageId),
        isNull(correspondenceAttachments.retiredAt)
      )
    )
    .returning({ id: correspondenceAttachments.id })
    .then((rows) => rows[0] ?? null)
}
