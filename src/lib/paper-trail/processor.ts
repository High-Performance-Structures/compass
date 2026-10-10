import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationFeatureSettings, projects } from "@/db/schema"
import {
  projectRecordDriveFiles,
  projectRecordDriveSnapshots,
  type ProjectRecordDriveFile,
} from "@/db/schema-paper-trail"
import { parseFeatureSettings, type PaperTrailSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { renderRecordSheet } from "@/lib/paper-trail/document"
import { internalDomainSet, resolveRecordFolder, type PaperTrailDrive } from "@/lib/paper-trail/folders"
import { PAPER_TRAIL_RECORDS, paperTrailAllows } from "@/lib/paper-trail/record-types"
import { sweepPaperTrailChanges } from "@/lib/paper-trail/sweep"
import { renderRecordSheetPdf } from "@/lib/paper-trail/render"

type Db = ReturnType<typeof getDb>

/** Records written per run. Each costs one PDF render and one or two Drive calls. */
const MAX_RECORDS_PER_RUN = 4
const MAX_SNAPSHOTS_PER_RUN = 2
/** How far ahead to look for due rows; extra rows are deferred, not worked. */
const CANDIDATE_LIMIT = 25
/** Rows the company has switched off are re-checked this often. */
const DISABLED_RECHECK_MS = 30 * 60 * 1000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000
const MAX_SNAPSHOT_ATTEMPTS = 6
/** The change sweep runs on minutes divisible by this. */
const SWEEP_EVERY_MINUTES = 10

const MILESTONE_LABELS: Readonly<Record<string, string>> = {
  sent: "Sent",
  signed: "Signed",
  approved: "Approved",
  answered: "Answered",
}

export type PaperTrailRunSummary = {
  readonly saved: number
  readonly unchanged: number
  readonly deferred: number
  readonly failed: number
  readonly snapshots: number
}

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1))
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error"
  return message.length > 300 ? `${message.slice(0, 297)}…` : message
}

/** Drive file names cannot contain slashes; keep them readable and bounded. */
export function driveFileName(base: string): string {
  const cleaned = base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim()
  return `${cleaned.slice(0, 150)}.pdf`
}

type OrgContext = {
  readonly settings: PaperTrailSettings
  readonly drive: PaperTrailDrive | null
  readonly driveError: string | null
  readonly internalDomains: ReadonlySet<string>
}

async function orgContext(
  db: Db,
  env: CloudflareEnv,
  organizationId: string,
  cache: Map<string, OrgContext>,
): Promise<OrgContext> {
  const cached = cache.get(organizationId)
  if (cached) return cached
  const settings = await readFeatureSettings(db, organizationId, "paper-trail")
  let drive: PaperTrailDrive | null = null
  let driveError: string | null = null
  if (settings.mode !== "off") {
    try {
      drive = await getProjectDocumentDriveContext({ db, env, organizationId })
    } catch (error) {
      driveError = errorMessage(error)
    }
  }
  const context: OrgContext = {
    settings,
    drive,
    driveError,
    internalDomains: internalDomainSet(drive?.googleEmail ?? "", settings.internalDomains),
  }
  cache.set(organizationId, context)
  return context
}

async function deferRow(db: Db, id: string, dueAt: Date): Promise<void> {
  await db
    .update(projectRecordDriveFiles)
    .set({ dueAt: dueAt.toISOString() })
    .where(eq(projectRecordDriveFiles.id, id))
}

async function failRow(db: Db, row: ProjectRecordDriveFile, error: string, now: Date): Promise<void> {
  const attempts = row.attempts + 1
  await db
    .update(projectRecordDriveFiles)
    .set({
      status: "failed",
      attempts,
      lastError: error,
      dueAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(eq(projectRecordDriveFiles.id, row.id))
}

async function projectFolderId(db: Db, projectId: string): Promise<string | null> {
  const [project] = await db
    .select({ folderId: projects.googleDriveFolderId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project?.folderId?.trim() || null
}

/** Refreshes one record's living copy. Returns what happened. */
async function syncRecord(
  db: Db,
  env: CloudflareEnv,
  row: ProjectRecordDriveFile,
  org: OrgContext,
  now: Date,
): Promise<"saved" | "unchanged" | "failed"> {
  const definition = PAPER_TRAIL_RECORDS[row.recordType]
  if (!definition.load) {
    await deferRow(db, row.id, new Date(now.getTime() + DISABLED_RECHECK_MS))
    return "unchanged"
  }
  if (!org.drive) {
    await failRow(db, row, org.driveError ?? "Google Drive is not connected.", now)
    return "failed"
  }
  try {
    const record = await definition.load(db, row.recordId)
    if (!record) {
      // Deleted in Compass: keep the last Drive copy, stop refreshing.
      await db
        .update(projectRecordDriveFiles)
        .set({ status: "removed", updatedAt: now.toISOString() })
        .where(eq(projectRecordDriveFiles.id, row.id))
      return "unchanged"
    }
    if (row.driveFileId && row.contentVersion === record.version) {
      await db
        .update(projectRecordDriveFiles)
        .set({ status: row.inPrivateFolder ? "held_private" : "synced", attempts: 0, lastError: null, updatedAt: now.toISOString() })
        .where(eq(projectRecordDriveFiles.id, row.id))
      return "unchanged"
    }
    const rootId = await projectFolderId(db, row.projectId)
    if (!rootId) {
      await failRow(db, row, "This project has no Google Drive folder yet.", now)
      return "failed"
    }
    const folder = await resolveRecordFolder({
      db,
      drive: org.drive,
      projectFolderId: rootId,
      category: definition.category,
      internalDomains: org.internalDomains,
      now,
    })
    if (!folder.ok) {
      await failRow(db, row, folder.error, now)
      return "failed"
    }
    const html = renderRecordSheet({ ...record.sheet, generatedAt: now.toISOString() })
    const pdf = await renderRecordSheetPdf(env, html)
    const blob = new Blob([pdf], { type: "application/pdf" })
    const name = driveFileName(record.fileBaseName)
    const { client, googleEmail } = org.drive
    let fileId = row.driveFileId
    if (fileId && row.driveFolderId === folder.folderId) {
      // Same file, new content: Drive keeps the earlier versions.
      await client.updateFileContent(googleEmail, fileId, blob, "application/pdf")
      if (row.fileName !== name) await client.renameFile(googleEmail, fileId, name)
    } else {
      const created = await client.uploadFile(googleEmail, {
        name,
        parentId: folder.folderId,
        mimeType: "application/pdf",
        data: blob,
        appProperties: { compassRecordType: row.recordType, compassRecordId: row.recordId },
      })
      fileId = created.id
    }
    await db
      .update(projectRecordDriveFiles)
      .set({
        status: folder.heldPrivate ? "held_private" : "synced",
        driveFileId: fileId,
        driveFolderId: folder.folderId,
        inPrivateFolder: folder.heldPrivate,
        fileName: name,
        contentVersion: record.version,
        lastSyncedAt: now.toISOString(),
        attempts: 0,
        lastError: null,
        updatedAt: now.toISOString(),
      })
      .where(eq(projectRecordDriveFiles.id, row.id))
    return "saved"
  } catch (error) {
    await failRow(db, row, errorMessage(error), now)
    return "failed"
  }
}

async function runSnapshots(
  db: Db,
  env: CloudflareEnv,
  orgs: Map<string, OrgContext>,
  now: Date,
): Promise<number> {
  const due = await db
    .select()
    .from(projectRecordDriveSnapshots)
    .where(inArray(projectRecordDriveSnapshots.status, ["pending", "failed"]))
    .orderBy(asc(projectRecordDriveSnapshots.requestedAt))
    .limit(CANDIDATE_LIMIT)
  let saved = 0
  for (const snapshot of due) {
    if (saved >= MAX_SNAPSHOTS_PER_RUN) break
    if (snapshot.attempts >= MAX_SNAPSHOT_ATTEMPTS) continue
    // Exponential retry spacing measured from the request time.
    const waitMs = snapshot.attempts === 0 ? 0 : backoffMs(snapshot.attempts)
    if (now.getTime() - Date.parse(snapshot.requestedAt) < waitMs) continue
    const org = await orgContext(db, env, snapshot.organizationId, orgs)
    if (!org.settings.milestoneCopies || !paperTrailAllows(org.settings, snapshot.recordType, snapshot.projectId)) continue
    const definition = PAPER_TRAIL_RECORDS[snapshot.recordType]
    if (!definition.load || !org.drive) continue
    try {
      const record = await definition.load(db, snapshot.recordId)
      if (!record) {
        await db.update(projectRecordDriveSnapshots).set({ status: "failed", attempts: MAX_SNAPSHOT_ATTEMPTS, lastError: "The record no longer exists." }).where(eq(projectRecordDriveSnapshots.id, snapshot.id))
        continue
      }
      const rootId = await projectFolderId(db, snapshot.projectId)
      if (!rootId) throw new Error("This project has no Google Drive folder yet.")
      const folder = await resolveRecordFolder({
        db,
        drive: org.drive,
        projectFolderId: rootId,
        category: definition.category,
        internalDomains: org.internalDomains,
        now,
      })
      if (!folder.ok) throw new Error(folder.error)
      const label = MILESTONE_LABELS[snapshot.milestone] ?? snapshot.milestone
      const day = snapshot.milestoneAt.slice(0, 10)
      const html = renderRecordSheet({ ...record.sheet, generatedAt: now.toISOString(), milestoneLabel: `${label} ${day}` })
      const pdf = await renderRecordSheetPdf(env, html)
      const name = driveFileName(`${record.fileBaseName} - ${label} ${day}`)
      const created = await org.drive.client.uploadFile(org.drive.googleEmail, {
        name,
        parentId: folder.folderId,
        mimeType: "application/pdf",
        data: new Blob([pdf], { type: "application/pdf" }),
        appProperties: { compassRecordType: snapshot.recordType, compassRecordId: snapshot.recordId, compassMilestone: snapshot.milestone },
      })
      await db
        .update(projectRecordDriveSnapshots)
        .set({ status: "saved", savedAt: now.toISOString(), driveFileId: created.id, fileName: name, lastError: null })
        .where(eq(projectRecordDriveSnapshots.id, snapshot.id))
      saved += 1
    } catch (error) {
      await db
        .update(projectRecordDriveSnapshots)
        .set({ status: "failed", attempts: snapshot.attempts + 1, lastError: errorMessage(error) })
        .where(eq(projectRecordDriveSnapshots.id, snapshot.id))
    }
  }
  return saved
}

/**
 * One scheduled pass. Picks up records whose last edit is older than the
 * company's quiet period, writes at most a few, and leaves the rest for the
 * next minute. Idle runs cost one indexed query.
 */
export async function runPaperTrail(db: Db, env: CloudflareEnv, now = new Date()): Promise<PaperTrailRunSummary> {
  if (now.getUTCMinutes() % SWEEP_EVERY_MINUTES === 0) {
    // Only companies that have saved paper-trail settings can have it on.
    const configured = await db
      .select({ organizationId: organizationFeatureSettings.organizationId, value: organizationFeatureSettings.value })
      .from(organizationFeatureSettings)
      .where(eq(organizationFeatureSettings.featureKey, "paper-trail"))
    for (const row of configured) {
      try {
        await sweepPaperTrailChanges(db, row.organizationId, parseFeatureSettings("paper-trail", row.value), now)
      } catch (error) {
        console.error(`[paper-trail] change sweep failed: ${error instanceof Error ? error.name : "unknown"}`)
      }
    }
  }
  const due = await db
    .select()
    .from(projectRecordDriveFiles)
    .where(
      and(
        inArray(projectRecordDriveFiles.status, ["pending", "failed"]),
        lte(projectRecordDriveFiles.dueAt, now.toISOString()),
      ),
    )
    .orderBy(asc(projectRecordDriveFiles.dueAt))
    .limit(CANDIDATE_LIMIT)

  const orgs = new Map<string, OrgContext>()
  let saved = 0
  let unchanged = 0
  let deferred = 0
  let failed = 0
  let worked = 0
  for (const row of due) {
    const org = await orgContext(db, env, row.organizationId, orgs)
    if (!paperTrailAllows(org.settings, row.recordType, row.projectId)) {
      await deferRow(db, row.id, new Date(now.getTime() + DISABLED_RECHECK_MS))
      deferred += 1
      continue
    }
    const quietUntil = Date.parse(row.changedAt) + org.settings.quietMinutes * 60 * 1000
    if (quietUntil > now.getTime()) {
      await deferRow(db, row.id, new Date(quietUntil))
      deferred += 1
      continue
    }
    if (worked >= MAX_RECORDS_PER_RUN) continue
    worked += 1
    const outcome = await syncRecord(db, env, row, org, now)
    if (outcome === "saved") saved += 1
    else if (outcome === "unchanged") unchanged += 1
    else failed += 1
  }
  const snapshots = await runSnapshots(db, env, orgs, now)
  return { saved, unchanged, deferred, failed, snapshots }
}

/** Counts for the project status line. */
export async function paperTrailProjectCounts(db: Db, projectId: string): Promise<{
  readonly saved: number
  readonly waiting: number
  readonly failed: number
  readonly heldPrivate: number
  readonly lastSavedAt: string | null
}> {
  const [row] = await db
    .select({
      saved: sql<number>`sum(case when ${projectRecordDriveFiles.status} = 'synced' then 1 else 0 end)`,
      waiting: sql<number>`sum(case when ${projectRecordDriveFiles.status} = 'pending' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${projectRecordDriveFiles.status} = 'failed' then 1 else 0 end)`,
      heldPrivate: sql<number>`sum(case when ${projectRecordDriveFiles.status} = 'held_private' then 1 else 0 end)`,
      lastSavedAt: sql<string | null>`max(${projectRecordDriveFiles.lastSyncedAt})`,
    })
    .from(projectRecordDriveFiles)
    .where(eq(projectRecordDriveFiles.projectId, projectId))
  return {
    saved: Number(row?.saved ?? 0),
    waiting: Number(row?.waiting ?? 0),
    failed: Number(row?.failed ?? 0),
    heldPrivate: Number(row?.heldPrivate ?? 0),
    lastSavedAt: row?.lastSavedAt ?? null,
  }
}
