import type { getDb } from "@/db"
import { users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { eq } from "drizzle-orm"

type ProjectDocumentDb = ReturnType<typeof getDb>

export type ProjectDocumentDriveContext = {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
}

/**
 * Project document publication and guarded downloads must use the same
 * organization-owned Drive identity. External viewers are authorized by
 * Compass records and should never need raw Google Drive ACLs.
 */
export async function getProjectDocumentDriveContext(input: {
  readonly db: ProjectDocumentDb
  readonly env: unknown
}): Promise<ProjectDocumentDriveContext> {
  const auth = await input.db
    .select()
    .from(googleAuth)
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!auth) throw new Error("Google Drive is not connected.")

  const connectedBy = await input.db
    .select({ email: users.email, googleEmail: users.googleEmail })
    .from(users)
    .where(eq(users.id, auth.connectedBy))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!connectedBy) throw new Error("Google Drive connection owner was not found.")

  const config = getGoogleConfig(input.env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  return {
    client: new DriveClient({ serviceAccountKey: parseServiceAccountKey(keyJson) }),
    googleEmail: connectedBy.googleEmail ?? connectedBy.email,
    sharedDriveId: auth.sharedDriveId,
  }
}
