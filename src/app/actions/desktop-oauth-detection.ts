"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import {
  anthropicOauthTokens,
  userProviderConfig,
} from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"
import { encrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"

// Store Claude Code credentials as the user's OAuth provider config.
// Reuses the same encryption and tables as the regular OAuth flow.
export async function storeDetectedOAuthCredentials(
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const encryptionKey = (
      env as unknown as Record<string, string>
    ).PROVIDER_KEY_ENCRYPTION_KEY

    if (!encryptionKey) {
      return {
        success: false,
        error:
          "Encryption key not configured (PROVIDER_KEY_ENCRYPTION_KEY)",
      }
    }

    const encryptedAccess = await encrypt(
      accessToken,
      encryptionKey,
      user.id
    )
    const encryptedRefresh = await encrypt(
      refreshToken,
      encryptionKey,
      user.id
    )

    const db = getDb(env.DB)
    const now = new Date().toISOString()
    // expiresAt is Unix timestamp in seconds, convert to ISO string
    const expiresAtIso = new Date(expiresAt * 1000).toISOString()

    // Store OAuth tokens
    await db
      .insert(anthropicOauthTokens)
      .values({
        userId: user.id,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: expiresAtIso,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: anthropicOauthTokens.userId,
        set: {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          expiresAt: expiresAtIso,
          updatedAt: now,
        },
      })
      .run()

    // Set provider type to anthropic-oauth
    await db
      .insert(userProviderConfig)
      .values({
        userId: user.id,
        providerType: "anthropic-oauth",
        apiKey: null,
        baseUrl: null,
        modelOverrides: null,
        isActive: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProviderConfig.userId,
        set: {
          providerType: "anthropic-oauth",
          apiKey: null,
          baseUrl: null,
          isActive: 1,
          updatedAt: now,
        },
      })
      .run()

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to store detected credentials",
    }
  }
}

// Check if user already has OAuth configured
export async function hasOAuthConfigured(): Promise<boolean> {
  try {
    const user = await getCurrentUser()
    if (!user) return false

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(userProviderConfig)
      .where(eq(userProviderConfig.userId, user.id))
      .get()

    // Has config and it's not empty/inactive
    return (
      config !== undefined &&
      config.isActive === 1 &&
      config.providerType !== ""
    )
  } catch {
    return false
  }
}
