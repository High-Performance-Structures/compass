import { headers } from "next/headers"

import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
  type ServiceAccountKey,
} from "@/lib/google/config"
import { requirePermission } from "@/lib/permissions"

/*
 * Google Drive access shared by the Drive actions and the actions that upload
 * documents into Drive (estimates, change orders). The organization's service
 * account acts as the signed-in user's Google identity.
 */

export function resolveGoogleEmail(user: AuthUser): string {
  return user.googleEmail ?? user.email
}

export async function getOrgGoogleAuth(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(googleAuth).limit(1)
  return rows[0] ?? null
}

async function getDecryptedServiceAccountKey(
  encryptedKey: string,
  encryptionKey: string
): Promise<ServiceAccountKey> {
  const json = await decrypt(
    encryptedKey,
    encryptionKey,
    getGoogleCryptoSalt()
  )
  return parseServiceAccountKey(json)
}

export async function buildDriveClient(
  encryptedKey: string,
  encryptionKey: string
): Promise<DriveClient> {
  const serviceAccountKey = await getDecryptedServiceAccountKey(
    encryptedKey,
    encryptionKey
  )
  return new DriveClient({ serviceAccountKey })
}

/** The calling page's origin (scheme + host), from the request headers. */
async function requestOrigin(): Promise<string | undefined> {
  const requestHeaders = await headers()
  const origin = requestHeaders.get("origin")
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  if (!host) return undefined
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}

/**
 * Starts a resumable Drive upload the browser sends the file to directly.
 * Requires document create permission and a linked Google identity.
 */
export async function createDriveUploadSession(
  fileName: string,
  mimeType: string,
  parentId?: string
): Promise<
  | { success: true; uploadUrl: string }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "create")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const config = getGoogleConfig(env)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )

    const uploadUrl = await client.initiateResumableUpload(
      googleEmail,
      {
        name: fileName,
        mimeType,
        parentId: parentId ?? auth.sharedDriveId ?? undefined,
        driveId: auth.sharedDriveId ?? undefined,
        // The browser uploads to this session directly, so Google must allow
        // this site's origin; without it the PUT fails with "Failed to fetch".
        browserOrigin: await requestOrigin(),
      }
    )

    return { success: true, uploadUrl }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to initiate upload",
    }
  }
}
