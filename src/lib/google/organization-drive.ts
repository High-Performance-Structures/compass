import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { googleAuth } from "@/db/schema-google"
import type { AuthUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"

export type OrganizationDriveContext = {
  readonly client: DriveClient
  readonly sheetsClient: SheetsClient
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
    throw new Error("Connect Google Drive before using organization Drive files.")
  }

  const config = getGoogleConfig(input.environment)
  const serviceAccountJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  const serviceAccountKey = parseServiceAccountKey(serviceAccountJson)
  return {
    client: new DriveClient({
      serviceAccountKey,
    }),
    sheetsClient: new SheetsClient(serviceAccountKey),
    userEmail: input.user.googleEmail ?? input.user.email,
  }
}
