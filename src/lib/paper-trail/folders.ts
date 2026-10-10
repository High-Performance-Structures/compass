import { eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { driveFolderShareChecks } from "@/db/schema-paper-trail"
import type { DriveClient } from "@/lib/google/client/drive-client"
import type { DrivePermission } from "@/lib/google/client/types"
import {
  classifyProjectFolderName,
  PROJECT_FILE_CATEGORIES,
  type ProjectFileCategoryKey,
} from "@/lib/project-files"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const SHARE_CHECK_TTL_MS = 60 * 60 * 1000

/** Private folder used when a record's usual subfolder is shared outside the company. */
export const PRIVATE_RECORDS_FOLDER_NAME = "Compass Records (internal)"

export type PaperTrailDrive = {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
}

export type RecordFolderResult =
  | { readonly ok: true; readonly folderId: string; readonly heldPrivate: boolean }
  | { readonly ok: false; readonly error: string }

function emailDomain(email: string | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1
  return email && at > 0 ? email.slice(at + 1).trim().toLowerCase() : null
}

export function internalDomainSet(googleEmail: string, configured: readonly string[]): ReadonlySet<string> {
  const domains = new Set(configured.map((domain) => domain.trim().toLowerCase()).filter(Boolean))
  const own = emailDomain(googleEmail)
  if (own) domains.add(own)
  return domains
}

/**
 * Who outside the company can open the item, as short labels with domains
 * only (never individual addresses), e.g. "people at gmail.com".
 */
export function outsideAccess(permissions: readonly DrivePermission[], internalDomains: ReadonlySet<string>): readonly string[] {
  const labels = new Set<string>()
  for (const permission of permissions) {
    if (permission.type === "anyone") {
      labels.add("anyone with the link")
      continue
    }
    if (permission.type === "domain") {
      const domain = permission.domain?.toLowerCase() ?? ""
      if (!internalDomains.has(domain)) labels.add(domain ? `everyone at ${domain}` : "an unnamed domain")
      continue
    }
    // "user" and "group": judge by the address's domain. An address we cannot
    // read is treated as outside, which errs toward the private folder.
    const domain = emailDomain(permission.emailAddress)
    if (domain === null) labels.add(permission.type === "group" ? "a group without a visible address" : "an account without a visible address")
    else if (!internalDomains.has(domain)) labels.add(permission.type === "group" ? `a group at ${domain}` : `people at ${domain}`)
  }
  return [...labels].sort()
}

/** True when anyone outside the company's domains can open the item. */
export function isSharedOutside(permissions: readonly DrivePermission[], internalDomains: ReadonlySet<string>): boolean {
  return outsideAccess(permissions, internalDomains).length > 0
}

/** Names who has outside access, for the record's status message. */
async function describeOutsideAccess(
  drive: PaperTrailDrive,
  folderId: string,
  internalDomains: ReadonlySet<string>,
): Promise<string> {
  try {
    const labels = outsideAccess(await drive.client.listPermissions(drive.googleEmail, folderId), internalDomains)
    return labels.length > 0 ? ` (${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ", …" : ""})` : ""
  } catch {
    return ""
  }
}

async function sharedOutside(
  db: ReturnType<typeof getDb>,
  drive: PaperTrailDrive,
  folderId: string,
  internalDomains: ReadonlySet<string>,
  now: Date,
): Promise<boolean> {
  const cached = await db
    .select()
    .from(driveFolderShareChecks)
    .where(eq(driveFolderShareChecks.folderId, folderId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (cached && now.getTime() - Date.parse(cached.checkedAt) < SHARE_CHECK_TTL_MS) {
    return cached.sharedOutside
  }
  const permissions = await drive.client.listPermissions(drive.googleEmail, folderId)
  const result = isSharedOutside(permissions, internalDomains)
  const checkedAt = now.toISOString()
  await db
    .insert(driveFolderShareChecks)
    .values({ folderId, sharedOutside: result, checkedAt })
    .onConflictDoUpdate({ target: driveFolderShareChecks.folderId, set: { sharedOutside: result, checkedAt } })
  return result
}

async function findOrCreateChildFolder(
  drive: PaperTrailDrive,
  parentId: string,
  match: (name: string) => boolean,
  createName: string,
): Promise<string> {
  const children = await drive.client.listFiles(drive.googleEmail, {
    folderId: parentId,
    query: `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}'`,
    pageSize: 200,
    ...(drive.sharedDriveId ? { driveId: drive.sharedDriveId } : {}),
  })
  const existing = children.files.find((file) => match(file.name))
  if (existing) return existing.id
  const created = await drive.client.createFolder(drive.googleEmail, { name: createName, parentId })
  return created.id
}

/**
 * The folder a record's copy belongs in: its category subfolder, or the
 * private records folder when that subfolder is shared outside the company.
 * Nothing is written when the project folder itself is shared outside,
 * because every folder inside it would inherit that sharing.
 */
export async function resolveRecordFolder(input: {
  readonly db: ReturnType<typeof getDb>
  readonly drive: PaperTrailDrive
  readonly projectFolderId: string
  readonly category: ProjectFileCategoryKey
  readonly internalDomains: ReadonlySet<string>
  readonly now: Date
}): Promise<RecordFolderResult> {
  const { db, drive, projectFolderId, internalDomains, now } = input
  if (await sharedOutside(db, drive, projectFolderId, internalDomains, now)) {
    return {
      ok: false,
      error: `The project's Drive folder is shared outside the company${await describeOutsideAccess(drive, projectFolderId, internalDomains)}, so internal records are not saved there. Change the folder's sharing, or add company domains in Settings → Workflows → Project paper trail.`,
    }
  }
  const category = PROJECT_FILE_CATEGORIES.find((item) => item.key === input.category)
  const createName = category?.currentNames[0] ?? category?.label ?? input.category
  const subfolderId = await findOrCreateChildFolder(
    drive,
    projectFolderId,
    (name) => classifyProjectFolderName(name)?.key === input.category,
    createName,
  )
  if (!(await sharedOutside(db, drive, subfolderId, internalDomains, now))) {
    return { ok: true, folderId: subfolderId, heldPrivate: false }
  }
  const privateId = await findOrCreateChildFolder(
    drive,
    projectFolderId,
    (name) => name === PRIVATE_RECORDS_FOLDER_NAME,
    PRIVATE_RECORDS_FOLDER_NAME,
  )
  if (await sharedOutside(db, drive, privateId, internalDomains, now)) {
    return { ok: false, error: `“${PRIVATE_RECORDS_FOLDER_NAME}” is shared outside the company${await describeOutsideAccess(drive, privateId, internalDomains)}.` }
  }
  return { ok: true, folderId: privateId, heldPrivate: true }
}
