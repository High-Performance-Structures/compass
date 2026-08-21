import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import type { AuthUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"

export type OrganizationDriveContext = {
  readonly client: DriveClient
  readonly userEmail: string
}

export async function getOrganizationDriveContext(input: {
  readonly db: ReturnType<typeof getDb>
  readonly environment: unknown
  readonly organizationId: string
  readonly user: AuthUser
}): Promise<OrganizationDriveContext> {
  const auth = await input.db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
    })
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, input.organizationId))
    .get()
  if (!auth) {
    throw new Error(
      "Connect Google Drive before saving estimate text templates."
    )
  }

  const config = getGoogleConfig(input.environment)
  const serviceAccountJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  return {
    client: new DriveClient({
      serviceAccountKey: parseServiceAccountKey(serviceAccountJson),
    }),
    userEmail: input.user.googleEmail ?? input.user.email,
  }
}
