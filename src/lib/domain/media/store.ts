/**
 * The only code that writes the media tables (architecture standard,
 * section 1): project videos, YouTube channel connections, social accounts,
 * Meta connection drafts and client Google Meet meetings. No auth logic
 * here; callers resolve access first.
 */
import { and, eq, isNull } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { projectClientMeetings, projectVideos, youtubeChannelConnections } from "@/db/schema"
import { socialAccounts, socialConnectionDrafts } from "@/db/schema-social"
import type { Db } from "@/lib/server/action-context"

type NewProjectVideo = typeof projectVideos.$inferInsert
type ProjectVideoValues = Partial<NewProjectVideo>
type NewYoutubeChannelConnection = typeof youtubeChannelConnections.$inferInsert
type NewSocialAccount = typeof socialAccounts.$inferInsert
type SocialAccountValues = Partial<NewSocialAccount>
type NewProjectClientMeeting = typeof projectClientMeetings.$inferInsert

// ---------------------------------------------------------------------------
// Project videos
// ---------------------------------------------------------------------------

/** An insert to run inside a caller's `db.batch` (with its daily log). */
export function projectVideoInsertStatement(db: Db, values: NewProjectVideo): BatchItem<"sqlite"> {
  return db.insert(projectVideos).values(values)
}

/**
 * An insert for imported videos (email): one row per source message, so a
 * repeat import leaves the existing video alone.
 */
export function projectVideoImportStatement(db: Db, values: NewProjectVideo): BatchItem<"sqlite"> {
  return db
    .insert(projectVideos)
    .values(values)
    .onConflictDoNothing({ target: [projectVideos.sourceSystem, projectVideos.sourceExternalId] })
}

export async function updateProjectVideo(
  db: Db,
  videoId: string,
  values: ProjectVideoValues
): Promise<void> {
  await db.update(projectVideos).set(values).where(eq(projectVideos.id, videoId)).run()
}

/** Updates a video on this project that has not been deleted. */
export async function updateLiveProjectVideo(
  db: Db,
  input: { readonly videoId: string; readonly projectId: string; readonly values: ProjectVideoValues }
): Promise<void> {
  await db
    .update(projectVideos)
    .set(input.values)
    .where(
      and(
        eq(projectVideos.id, input.videoId),
        eq(projectVideos.projectId, input.projectId),
        isNull(projectVideos.deletedAt)
      )
    )
    .run()
}

/** Soft-deletes a project's video; returned as a statement so it can join a batch. */
export function projectVideoDeleteStatement(
  db: Db,
  input: { readonly videoId: string; readonly projectId: string; readonly now: string }
): BatchItem<"sqlite"> {
  return db
    .update(projectVideos)
    .set({ publishStatus: "deleted", deletedAt: input.now, updatedAt: input.now })
    .where(and(eq(projectVideos.id, input.videoId), eq(projectVideos.projectId, input.projectId)))
}

// ---------------------------------------------------------------------------
// YouTube channel connections
// ---------------------------------------------------------------------------

/** One connection per channel per organization; reconnecting refreshes it. */
export async function upsertYoutubeChannelConnection(
  db: Db,
  values: NewYoutubeChannelConnection
): Promise<void> {
  await db
    .insert(youtubeChannelConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [youtubeChannelConnections.organizationId, youtubeChannelConnections.channelKey],
      set: {
        channelId: values.channelId,
        channelTitle: values.channelTitle,
        googleAccountEmail: values.googleAccountEmail,
        refreshTokenEncrypted: values.refreshTokenEncrypted,
        grantedScopes: values.grantedScopes,
        status: values.status,
        connectedBy: values.connectedBy,
        connectedAt: values.connectedAt,
        lastError: null,
        updatedAt: values.updatedAt,
      },
    })
    .run()
}

export async function updateYoutubeChannelConnection(
  db: Db,
  connectionId: string,
  values: Partial<NewYoutubeChannelConnection>
): Promise<void> {
  await db
    .update(youtubeChannelConnections)
    .set(values)
    .where(eq(youtubeChannelConnections.id, connectionId))
    .run()
}

export async function deleteYoutubeChannelConnection(db: Db, connectionId: string): Promise<void> {
  await db.delete(youtubeChannelConnections).where(eq(youtubeChannelConnections.id, connectionId)).run()
}

// ---------------------------------------------------------------------------
// Social accounts and Meta connection drafts
// ---------------------------------------------------------------------------

type SocialAccountUpsert = {
  readonly values: NewSocialAccount
  /** What a reconnect overwrites; it differs by provider. */
  readonly update: SocialAccountValues
}

/**
 * One account per organization, department and platform. Returned as a
 * statement so several departments can be saved in one batch.
 */
export function socialAccountUpsertStatement(db: Db, input: SocialAccountUpsert): BatchItem<"sqlite"> {
  return db
    .insert(socialAccounts)
    .values(input.values)
    .onConflictDoUpdate({
      target: [socialAccounts.organizationId, socialAccounts.department, socialAccounts.platform],
      set: input.update,
    })
}

export async function upsertSocialAccount(db: Db, input: SocialAccountUpsert): Promise<void> {
  await db
    .insert(socialAccounts)
    .values(input.values)
    .onConflictDoUpdate({
      target: [socialAccounts.organizationId, socialAccounts.department, socialAccounts.platform],
      set: input.update,
    })
    .run()
}

export function socialAccountUpdateStatement(
  db: Db,
  accountId: string,
  values: SocialAccountValues
): BatchItem<"sqlite"> {
  return db.update(socialAccounts).set(values).where(eq(socialAccounts.id, accountId))
}

export async function updateSocialAccount(
  db: Db,
  accountId: string,
  values: SocialAccountValues
): Promise<void> {
  await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, accountId)).run()
}

export async function insertSocialConnectionDraft(
  db: Db,
  values: typeof socialConnectionDrafts.$inferInsert
): Promise<void> {
  await db.insert(socialConnectionDrafts).values(values).run()
}

export async function deleteSocialConnectionDraft(db: Db, draftId: string): Promise<void> {
  await db.delete(socialConnectionDrafts).where(eq(socialConnectionDrafts.id, draftId)).run()
}

// ---------------------------------------------------------------------------
// Client meetings
// ---------------------------------------------------------------------------

export async function insertProjectClientMeeting(db: Db, values: NewProjectClientMeeting): Promise<void> {
  await db.insert(projectClientMeetings).values(values)
}

export async function updateProjectClientMeeting(
  db: Db,
  meetingId: string,
  values: Partial<NewProjectClientMeeting>
): Promise<void> {
  await db.update(projectClientMeetings).set(values).where(eq(projectClientMeetings.id, meetingId))
}
