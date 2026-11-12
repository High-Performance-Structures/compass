import { and, eq } from "drizzle-orm"

import { peopleView } from "@/lib/domain/identity/views"
import { googleAuth, googleStarredFiles } from "@/db/schema-google"
import type { Db } from "@/lib/server/action-context"

const people = peopleView()

/*
 * The only code that writes the organization's Google Drive connection
 * (`google_auth`: encrypted service-account key, Workspace domain, chosen
 * shared drive) and each person's starred Drive files
 * (`google_starred_files`). Reading the connection itself is
 * `getOrgGoogleAuth` in drive-session.ts. No access rules here; the Drive
 * actions check permission first.
 */

type DriveConnectionInsert = typeof googleAuth.$inferInsert

/** Google file ids this person has starred in Compass. */
export async function readStarredFileIds(db: Db, userId: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ googleFileId: googleStarredFiles.googleFileId })
    .from(googleStarredFiles)
    .where(eq(googleStarredFiles.userId, userId))
  return new Set(rows.map(row => row.googleFileId))
}

/** Stars the file if it isn't starred, unstars it if it is. Returns the new state. */
export async function toggleStarredFile(db: Db, userId: string, googleFileId: string): Promise<boolean> {
  const existing = await db
    .select({ id: googleStarredFiles.id })
    .from(googleStarredFiles)
    .where(and(eq(googleStarredFiles.userId, userId), eq(googleStarredFiles.googleFileId, googleFileId)))
    .get()

  if (existing) {
    await db.delete(googleStarredFiles).where(eq(googleStarredFiles.id, existing.id)).run()
    return false
  }

  await db
    .insert(googleStarredFiles)
    .values({ id: crypto.randomUUID(), userId, googleFileId, createdAt: new Date().toISOString() })
    .run()
  return true
}

/** Compass keeps one Drive connection: connecting again replaces the old one. */
export async function replaceDriveConnection(db: Db, values: DriveConnectionInsert): Promise<void> {
  await db.delete(googleAuth).run()
  await db.insert(googleAuth).values(values).run()
}

export async function deleteDriveConnection(db: Db): Promise<void> {
  await db.delete(googleAuth).run()
}

/** `driveId` null means "My Drive" instead of a shared drive. */
export async function setConnectionSharedDrive(
  db: Db,
  connectionId: string,
  driveId: string | null,
  driveName: string | null
): Promise<void> {
  await db
    .update(googleAuth)
    .set({ sharedDriveId: driveId, sharedDriveName: driveName, updatedAt: new Date().toISOString() })
    .where(eq(googleAuth.id, connectionId))
    .run()
}

/** The Workspace domain of this organization's Drive connection, if connected. */
export async function readConnectionWorkspaceDomain(db: Db, organizationId: string): Promise<string | null> {
  const row = await db
    .select({ workspaceDomain: googleAuth.workspaceDomain })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, organizationId))
    .get()
  return row?.workspaceDomain ?? null
}

/** The Google identity of whoever connected Drive (Field Mode reads as them). */
export async function readConnectionOwnerGoogleEmail(db: Db, connectedBy: string): Promise<string | null> {
  const row = await db
    .select({ email: people.email, googleEmail: people.googleEmail })
    .from(people)
    .where(eq(people.id, connectedBy))
    .get()
  return row ? (row.googleEmail ?? row.email) : null
}
