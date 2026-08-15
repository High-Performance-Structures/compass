import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"

const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

function configuredString(env: Record<string, string>, key: string): string | null {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : null
}

function uploadIdentity(input: {
  readonly env: Record<string, string>
  readonly googleEmail: string | null
  readonly userEmail: string
}): string {
  const configured = configuredString(input.env, "COMPASS_GOOGLE_UPLOAD_USER")
  if (configured) return configured
  if (input.googleEmail) return input.googleEmail
  if (input.userEmail.endsWith("@hps-colorado.com")) return input.userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

export async function projectAudienceDriveClient(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: Record<string, string>
  readonly googleEmail: string | null
  readonly organizationId: string
  readonly userEmail: string
}): Promise<{
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
}> {
  const [auth] = await input.db
    .select()
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, input.organizationId))
    .limit(1)
  if (!auth) throw new Error("Google Drive is not connected.")

  const config = getGoogleConfig(input.env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  const client = new DriveClient({ serviceAccountKey: parseServiceAccountKey(keyJson) })
  return {
    client,
    googleEmail: uploadIdentity(input),
    sharedDriveId: auth.sharedDriveId,
  }
}

export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export async function findOrCreateProjectAudienceFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
  readonly projectFolderId: string
  readonly audience: "owner" | "sub_vendor"
}): Promise<string> {
  const name = input.audience === "owner" ? "Owner Uploads" : "Sub-Supplier Uploads"
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.projectFolderId,
    driveId: input.sharedDriveId ?? undefined,
    pageSize: 10,
    query:
      "mimeType = 'application/vnd.google-apps.folder' and " +
      `name = '${escapeDriveQueryValue(name)}'`,
  })
  const existing = result.files[0]
  if (existing) return existing.id

  const created = await input.client.createFolder(input.googleEmail, {
    name,
    parentId: input.projectFolderId,
    driveId: input.sharedDriveId ?? undefined,
  })
  return created.id
}
