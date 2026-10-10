import "server-only"

import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { userProviderConfig } from "@/db/schema-ai-config"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"

// Returns a saved provider config with its API key decrypted. Server-only on
// purpose: it takes any user ID and does no auth check, so it must never be
// exported from a "use server" module, where browsers could call it.

export interface ProviderConfigForJwt {
  readonly type: string
  readonly apiKey: string | null
  readonly baseUrl: string | null
  readonly modelOverrides: Record<string, string> | null
}

export async function getProviderConfigForJwt(
  userId: string
): Promise<ProviderConfigForJwt | null> {
  try {
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(userProviderConfig)
      .where(eq(userProviderConfig.userId, userId))
      .get()

    if (!config || config.isActive !== 1) {
      return null
    }

    const encryptionKey = (
      env as unknown as Record<string, string>
    ).PROVIDER_KEY_ENCRYPTION_KEY

    let decryptedApiKey: string | null = null
    if (config.apiKey) {
      if (!encryptionKey) {
        // Can't decrypt, but still return the config without a key
        decryptedApiKey = null
      } else {
        try {
          decryptedApiKey = await decrypt(
            config.apiKey,
            encryptionKey,
            userId
          )
        } catch (err) {
          console.error("Failed to decrypt API key:", err)
          decryptedApiKey = null
        }
      }
    }

    let modelOverrides: Record<string, string> | null = null
    if (config.modelOverrides) {
      try {
        modelOverrides = JSON.parse(
          config.modelOverrides
        ) as Record<string, string>
      } catch {
        modelOverrides = null
      }
    }

    return {
      type: config.providerType,
      apiKey: decryptedApiKey,
      baseUrl: config.baseUrl,
      modelOverrides,
    }
  } catch (err) {
    console.error("Failed to get provider config for JWT:", err)
    return null
  }
}
