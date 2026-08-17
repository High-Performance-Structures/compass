import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectExternalLinks } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

type Db = ReturnType<typeof getDb>

function envString(env: unknown, key: string): string | null {
  if (typeof env !== "object" || env === null || !(key in env)) return null
  const rawValue = Reflect.get(env, key)
  const value = typeof rawValue === "string" ? rawValue.trim() : ""
  return value ? value : null
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null
  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null
  const idMatch = value.match(/[?&]id=([^&#]+)/)
  return idMatch?.[1] ?? null
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function findOrCreateFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly parentId: string
  readonly driveId: string | null
  readonly name: string
}): Promise<string> {
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.parentId,
    driveId: input.driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(input.name)}'`,
  })
  const existing = result.files[0]
  if (existing) return existing.id
  const created = await input.client.createFolder(input.googleEmail, {
    name: input.name,
    parentId: input.parentId,
    driveId: input.driveId ?? undefined,
  })
  return created.id
}

async function projectDriveFolderId(
  db: Db,
  projectId: string,
  mappedFolderId: string | null
): Promise<string | null> {
  if (mappedFolderId) return mappedFolderId
  const link = await db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return link?.externalId ?? driveFolderIdFromUrl(link?.externalUrl ?? null)
}

export type WarrantyDriveContext = {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly driveId: string | null
}

export async function getWarrantyDriveContext(input: {
  readonly db: Db
  readonly env: unknown
  readonly userEmail: string
  readonly googleEmail: string | null
}): Promise<WarrantyDriveContext> {
  const auth = await input.db
    .select()
    .from(googleAuth)
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!auth) throw new Error("Google Drive is not connected.")
  const config = getGoogleConfig(input.env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  return {
    client: new DriveClient({ serviceAccountKey: parseServiceAccountKey(keyJson) }),
    googleEmail:
      envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER") ??
      input.googleEmail ??
      (input.userEmail.endsWith("@hps-colorado.com")
        ? input.userEmail
        : DEFAULT_COMPASS_GOOGLE_UPLOAD_USER),
    driveId: auth.sharedDriveId,
  }
}

export async function warrantyClaimFolderId(input: {
  readonly db: Db
  readonly projectId: string
  readonly mappedProjectFolderId: string | null
  readonly claimNumber: string
  readonly drive: WarrantyDriveContext
}): Promise<string> {
  const projectFolderId = await projectDriveFolderId(
    input.db,
    input.projectId,
    input.mappedProjectFolderId
  )
  if (!projectFolderId) {
    throw new Error("Map this project to a Google Drive folder before uploading.")
  }
  const warrantyFolderId = await findOrCreateFolder({
    ...input.drive,
    parentId: projectFolderId,
    name: "Warranty Claims",
  })
  return findOrCreateFolder({
    ...input.drive,
    parentId: warrantyFolderId,
    name: input.claimNumber,
  })
}
