import "server-only"

import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm"

import type { getDb } from "@/db"
import { dailyLogs, projectClientMeetings, projects, users } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCompassGmailAccessToken } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { internalDomainSet, resolveRecordFolder } from "@/lib/paper-trail/folders"

type Db = ReturnType<typeof getDb>

const MEET_API = "https://meet.googleapis.com/v2"
const MEET_READ_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly"
/** Google finishes writing a transcript Doc a few minutes after the call. */
const SETTLE_MS = 10 * 60_000
/** Re-check a pending meeting at most this often. */
const RECHECK_MS = 10 * 60_000
/** Stop looking once a call ended this long ago without a transcript. */
const GIVE_UP_MS = 24 * 60 * 60_000
/** Keeps a very long call's log row a reasonable size. */
const MAX_LOG_TEXT = 200_000
/** Google deletes transcript entries 30 days after the call. */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
const BATCH_SIZE = 10

export type TranscriptSweepSummary = {
  readonly checked: number
  readonly saved: number
  readonly none: number
  readonly failed: number
}

type TranscriptDoc = {
  readonly documentId: string
  readonly startTime: string | null
}

type LookupResult =
  | { readonly kind: "found"; readonly docs: readonly TranscriptDoc[] }
  | { readonly kind: "waiting" }
  | { readonly kind: "none" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function arrayField(value: unknown, key: string): readonly Record<string, unknown>[] {
  if (!isRecord(value)) return []
  const items = value[key]
  return Array.isArray(items) ? items.filter(isRecord) : []
}

/** "https://meet.google.com/abc-defg-hij" → "abc-defg-hij". */
export function meetingCodeFromUrl(meetingUrl: string | null): string | null {
  if (!meetingUrl) return null
  try {
    const url = new URL(meetingUrl)
    if (url.hostname !== "meet.google.com") return null
    const code = url.pathname.replace(/^\/+/, "").split("/")[0] ?? ""
    return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code) ? code : null
  } catch {
    return null
  }
}

async function meetGet(accessToken: string, path: string): Promise<unknown> {
  const response = await fetch(`${MEET_API}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? stringField(payload.error, "message") : null
    throw new Error(error ?? `Google Meet request failed (${response.status})`)
  }
  return payload
}

/**
 * Finds the transcript Docs Google wrote for a meeting's calls. A meeting
 * code is unique to its calendar event, so every conference on it belongs to
 * this meeting.
 */
async function lookupMeetingTranscripts(input: {
  readonly accessToken: string
  readonly meetingCode: string
  readonly endsAt: string
  readonly now: Date
}): Promise<LookupResult> {
  const filter = encodeURIComponent(`space.meeting_code = "${input.meetingCode}"`)
  const records = arrayField(
    await meetGet(input.accessToken, `conferenceRecords?filter=${filter}&pageSize=10`),
    "conferenceRecords"
  )
  const docs: TranscriptDoc[] = []
  let stillWriting = false
  for (const record of records) {
    const name = stringField(record, "name")
    if (!name) continue
    // A call still in progress has no endTime yet.
    if (!stringField(record, "endTime")) stillWriting = true
    const transcripts = arrayField(await meetGet(input.accessToken, `${name}/transcripts`), "transcripts")
    for (const transcript of transcripts) {
      const state = stringField(transcript, "state")
      const destination = isRecord(transcript.docsDestination) ? transcript.docsDestination : null
      const documentId = destination ? stringField(destination, "document") : null
      if (state === "FILE_GENERATED" && documentId) {
        docs.push({ documentId, startTime: stringField(transcript, "startTime") })
      } else {
        stillWriting = true
      }
    }
  }
  if (docs.length > 0 && !stillWriting) return { kind: "found", docs }
  const endedLongAgo = input.now.getTime() - Date.parse(input.endsAt) > GIVE_UP_MS
  if (endedLongAgo) return docs.length > 0 ? { kind: "found", docs } : { kind: "none" }
  return { kind: "waiting" }
}

function transcriptFileName(title: string, startsAt: string, part: number, parts: number): string {
  const day = startsAt.slice(0, 10)
  const base = `Meeting transcript - ${title} - ${day}${parts > 1 ? ` (part ${part})` : ""}`
  return `${base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150)}.pdf`
}

async function saveTranscripts(input: {
  readonly db: Db
  readonly env: CloudflareEnv
  readonly meeting: typeof projectClientMeetings.$inferSelect
  readonly projectFolderId: string
  readonly docs: readonly TranscriptDoc[]
  readonly now: Date
}): Promise<{ readonly fileId: string; readonly url: string | null; readonly text: string }> {
  const { db, env, meeting, now } = input
  const drive = await getProjectDocumentDriveContext({ db, env, organizationId: meeting.organizationId })
  const settings = await readFeatureSettings(db, meeting.organizationId, "paper-trail")
  // Transcripts are internal: the same check the paper trail uses keeps them
  // out of any folder shared with the client or vendors.
  const folder = await resolveRecordFolder({
    db,
    drive,
    projectFolderId: input.projectFolderId,
    category: "meeting-notes",
    subfolders: [],
    internalDomains: internalDomainSet(drive.googleEmail, settings.internalDomains),
    now,
  })
  if (!folder.ok) throw new Error(folder.error)

  const ordered = [...input.docs].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))
  let first: { fileId: string; url: string | null } | null = null
  const texts: string[] = []
  for (const [index, doc] of ordered.entries()) {
    // The Doc lives in the host's Drive, so export it as the host.
    const exported = await drive.client.exportFile(meeting.organizerEmail, doc.documentId, "application/pdf")
    if (!exported.ok) throw new Error(`Google Drive could not export the transcript (${exported.status})`)
    const created = await drive.client.uploadFile(drive.googleEmail, {
      name: transcriptFileName(meeting.title, meeting.startsAt, index + 1, ordered.length),
      parentId: folder.folderId,
      mimeType: "application/pdf",
      data: new Blob([await exported.arrayBuffer()], { type: "application/pdf" }),
      appProperties: { compassRecordType: "client_meeting_transcript", compassRecordId: meeting.id },
    })
    first ??= { fileId: created.id, url: created.webViewLink ?? null }
    const plain = await drive.client.exportFile(meeting.organizerEmail, doc.documentId, "text/plain")
    if (plain.ok) texts.push((await plain.text()).trim())
  }
  if (!first) throw new Error("No transcript was available to save")
  return { ...first, text: texts.filter(Boolean).join("\n\n") }
}

function localDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function localTime(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  } catch {
    return iso
  }
}

function emailList(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/**
 * The transcript as an internal draft daily log on the meeting day, written
 * as the host. Staff review it and may share it with the owner like any log.
 */
async function createTranscriptDailyLog(input: {
  readonly db: Db
  readonly meeting: typeof projectClientMeetings.$inferSelect
  readonly text: string
  readonly now: Date
}): Promise<string> {
  const { db, meeting } = input
  const host = await db
    .select({ displayName: users.displayName, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(eq(users.id, meeting.organizerUserId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const hostName =
    host?.displayName?.trim() || [host?.firstName, host?.lastName].filter(Boolean).join(" ").trim() || meeting.organizerEmail
  const guests = emailList(meeting.guestEmails)
  const staff = emailList(meeting.staffEmails)
  const header = [
    `Project meeting: ${meeting.title}`,
    `Google Meet hosted by ${hostName}, ${localTime(meeting.startsAt, meeting.timeZone)} to ${localTime(meeting.endsAt, meeting.timeZone)}`,
    guests.length > 0 ? `Guests: ${guests.join(", ")}` : null,
    staff.length > 0 ? `Staff: ${staff.join(", ")}` : null,
  ].filter((line): line is string => line !== null)
  const body = input.text || "Google saved a transcript for this call, but its text could not be read. Open the PDF in the project's Meeting Notes folder."
  const workCompleted = `${header.join("\n")}\n\nTranscript\n\n${body}`.slice(0, MAX_LOG_TEXT)
  const id = `meet-transcript-${meeting.id}`
  const stamp = input.now.toISOString()
  await db
    .insert(dailyLogs)
    .values({
      id,
      projectId: meeting.projectId,
      authorId: meeting.organizerUserId,
      sourceSystem: "google_meet",
      sourceExternalId: meeting.id,
      logDate: localDate(meeting.startsAt, meeting.timeZone),
      workCompleted,
      notes: "Saved automatically from the Google Meet transcript. The PDF is in the project's Meeting Notes folder in Drive. Review before sharing with the client.",
      // Internal until staff choose to share it.
      isClientVisible: false,
      reviewStatus: "draft",
      tags: "client-meeting",
      syncStatus: "pending",
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoNothing({ target: dailyLogs.id })
  return id
}

async function markTranscript(
  db: Db,
  meetingId: string,
  values: Partial<typeof projectClientMeetings.$inferInsert>,
  now: Date
): Promise<void> {
  await db
    .update(projectClientMeetings)
    .set({ ...values, transcriptCheckedAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(eq(projectClientMeetings.id, meetingId))
}

/**
 * Scheduled: for client meetings that have ended, save the Meet transcript
 * to the project's Meeting Notes folder, add it as an internal draft daily
 * log, and note it in Activity.
 */
export async function sweepClientMeetingTranscripts(
  db: Db,
  env: CloudflareEnv,
  now = new Date()
): Promise<TranscriptSweepSummary> {
  const settled = new Date(now.getTime() - SETTLE_MS).toISOString()
  const oldest = new Date(now.getTime() - MAX_AGE_MS).toISOString()
  const recheckBefore = new Date(now.getTime() - RECHECK_MS).toISOString()
  const due = await db
    .select({ meeting: projectClientMeetings, projectFolderId: projects.googleDriveFolderId })
    .from(projectClientMeetings)
    .innerJoin(projects, eq(projects.id, projectClientMeetings.projectId))
    .where(
      and(
        eq(projectClientMeetings.status, "scheduled"),
        lt(projectClientMeetings.endsAt, settled),
        gt(projectClientMeetings.endsAt, oldest),
        or(isNull(projectClientMeetings.transcriptStatus), inArray(projectClientMeetings.transcriptStatus, ["pending", "error"])),
        or(isNull(projectClientMeetings.transcriptCheckedAt), lt(projectClientMeetings.transcriptCheckedAt, recheckBefore))
      )
    )
    .orderBy(projectClientMeetings.endsAt)
    .limit(BATCH_SIZE)

  let saved = 0
  let none = 0
  let failed = 0
  for (const { meeting, projectFolderId } of due) {
    try {
      const meetingCode = meetingCodeFromUrl(meeting.meetingUrl)
      if (!meetingCode) {
        await markTranscript(db, meeting.id, { transcriptStatus: "none", transcriptError: null }, now)
        none += 1
        continue
      }
      const token = await getCompassGmailAccessToken({
        env,
        db,
        organizationId: meeting.organizationId,
        scopes: [MEET_READ_SCOPE],
        sender: meeting.organizerEmail,
      })
      if (!token.success) throw new Error(token.error)
      const lookup = await lookupMeetingTranscripts({
        accessToken: token.accessToken,
        meetingCode,
        endsAt: meeting.endsAt,
        now,
      })
      if (lookup.kind === "waiting") {
        await markTranscript(db, meeting.id, { transcriptStatus: "pending" }, now)
        continue
      }
      if (lookup.kind === "none") {
        await markTranscript(db, meeting.id, { transcriptStatus: "none", transcriptError: null }, now)
        none += 1
        continue
      }
      if (!projectFolderId) throw new Error("This project has no Google Drive folder yet.")
      const file = await saveTranscripts({ db, env, meeting, projectFolderId, docs: lookup.docs, now })
      const dailyLogId = await createTranscriptDailyLog({ db, meeting, text: file.text, now })
      await markTranscript(
        db,
        meeting.id,
        {
          transcriptStatus: "saved",
          transcriptDriveFileId: file.fileId,
          transcriptUrl: file.url,
          transcriptText: file.text || null,
          transcriptError: null,
          dailyLogId,
        },
        now
      )
      await recordActivityEvent({
        db,
        actor: {
          id: null,
          email: "google-meet",
          displayName: "Google Meet",
          firstName: null,
          lastName: null,
          role: "system",
        },
        organizationId: meeting.organizationId,
        projectId: meeting.projectId,
        category: "file",
        action: "client_meeting_transcript_saved",
        entityType: "project_client_meeting",
        entityId: meeting.id,
        summary: `Saved the Google Meet transcript for "${meeting.title}" to Meeting Notes and as a draft daily log`,
      })
      saved += 1
    } catch (error) {
      failed += 1
      await markTranscript(
        db,
        meeting.id,
        {
          transcriptStatus: "error",
          transcriptError: (error instanceof Error ? error.message : "Transcript import failed").slice(0, 500),
        },
        now
      )
    }
  }
  return { checked: due.length, saved, none, failed }
}
