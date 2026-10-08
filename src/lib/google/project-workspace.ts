import { eq } from "drizzle-orm"

import { getDb } from "@/db"
import { users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { DriveClient } from "@/lib/google/client/drive-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { resolveProjectIntakeIntegrationEmail } from "@/lib/google/project-intake-identity"

export type ProjectWorkspaceClients = {
  readonly sheets: SheetsClient
  readonly drive: DriveClient
  readonly projectIntakeGoogleEmail: string
}

export async function projectWorkspaceClients(input: {
  readonly environment: CloudflareEnv
  readonly organizationId: string
}): Promise<ProjectWorkspaceClients> {
  const db = getDb(input.environment.DB)
  const authRows = await db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
      connectorGoogleEmail: users.googleEmail,
      connectorEmail: users.email,
    })
    .from(googleAuth)
    .innerJoin(users, eq(users.id, googleAuth.connectedBy))
    .where(eq(googleAuth.organizationId, input.organizationId))
    .limit(1)
  const auth = authRows[0]
  if (!auth) throw new Error("Google Workspace service account is not connected.")

  const config = getGoogleConfig(input.environment)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt(),
  )
  const serviceAccountKey = parseServiceAccountKey(keyJson)
  return {
    sheets: new SheetsClient(serviceAccountKey),
    drive: new DriveClient({ serviceAccountKey }),
    projectIntakeGoogleEmail: resolveProjectIntakeIntegrationEmail({
      connectorGoogleEmail: auth.connectorGoogleEmail,
      connectorEmail: auth.connectorEmail,
    }),
  }
}
