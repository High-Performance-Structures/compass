import { headers } from "next/headers"

import { googleAuth } from "@/db/schema-google"
import { actionFailure, errorMessage, type ActionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
  type ServiceAccountKey,
} from "@/lib/google/config"
import { requirePermission, type Action, type Resource } from "@/lib/permissions"
import { requireUserContext, type Db } from "@/lib/server/action-context"

/*
 * Google Drive access shared by the Drive actions and the actions that upload
 * documents into Drive (estimates, change orders). The organization's service
 * account acts as the signed-in user's Google identity.
 */

function resolveGoogleEmail(user: AuthUser): string {
  return user.googleEmail ?? user.email
}

export type OrgGoogleAuth = typeof googleAuth.$inferSelect

export async function getOrgGoogleAuth(db: Db): Promise<OrgGoogleAuth | null> {
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

/** Everything a Drive action needs once the caller is allowed in. */
type DriveSession = {
  readonly user: AuthUser
  readonly db: Db
  /** The organization's Drive connection (service account, shared drive). */
  readonly auth: OrgGoogleAuth
  readonly client: DriveClient
  /** The Google identity the service account acts as: the signed-in user's. */
  readonly googleEmail: string
}

export type DriveSessionResult =
  | { readonly success: true; readonly session: DriveSession }
  | ActionFailure

/**
 * The opening every Drive action shares: a signed-in user with `resource` /
 * `action` permission, the organization's Drive connection, and a client
 * acting as that user.
 *
 * Sign-in and permission failures throw, as `requireAuth` and
 * `requirePermission` do, so the action's catch block reports them. A missing
 * Google identity or Drive connection comes back as a failure the action
 * returns as is.
 */
export async function openDriveSession(
  resource: Resource,
  action: Action
): Promise<DriveSessionResult> {
  const { user, db, env } = await requireUserContext()
  requirePermission(user, resource, action)

  const googleEmail = resolveGoogleEmail(user)
  if (!googleEmail) return actionFailure("No Google account linked")

  const auth = await getOrgGoogleAuth(db)
  if (!auth) return actionFailure("Google Drive not connected")

  const client = await buildDriveClient(
    auth.serviceAccountKeyEncrypted,
    getGoogleConfig(env).encryptionKey
  )
  return { success: true, session: { user, db, auth, client, googleEmail } }
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
    const opened = await openDriveSession("document", "create")
    if (!opened.success) return opened
    const { client, auth, googleEmail } = opened.session

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
    return actionFailure(errorMessage(err, "Failed to initiate upload"))
  }
}
