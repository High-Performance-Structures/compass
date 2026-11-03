"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { anthropicOauthTokens } from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"
import { encrypt, decrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"
import { deleteUserProviderConfig, saveAnthropicOAuthProviderConfig } from "@/lib/domain/settings/store"
import {
  exchangeCode as exchangeOAuthCode_,
  refreshAccessToken as refreshToken_,
} from "agent-core"
import { userContext } from "@/lib/server/action-context"
import { envValue } from "@/lib/shared/env"

export async function exchangeOAuthCode(
  code: string,
  state: string,
  verifier: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const tokens = await exchangeOAuthCode_(code, state, verifier)

    const { env } = await getCloudflareContext()
    const encryptionKey = envValue(env, "PROVIDER_KEY_ENCRYPTION_KEY")

    if (!encryptionKey) {
      return {
        success: false,
        error:
          "Encryption key not configured (PROVIDER_KEY_ENCRYPTION_KEY)",
      }
    }

    const encryptedAccess = await encrypt(
      tokens.access,
      encryptionKey,
      user.id
    )
    const encryptedRefresh = await encrypt(
      tokens.refresh,
      encryptionKey,
      user.id
    )

    const db = getDb(env.DB)
    const now = new Date().toISOString()
    const expiresAt = new Date(tokens.expiresAt).toISOString()

    await db
      .insert(anthropicOauthTokens)
      .values({
        userId: user.id,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: anthropicOauthTokens.userId,
        set: {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          expiresAt,
          updatedAt: now,
        },
      })
      .run()

    await saveAnthropicOAuthProviderConfig(db, user.id, now)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to exchange OAuth code",
    }
  }
}

// Returns a valid access token for the given userId, refreshing if needed.
// Returns null if no token exists or on any error.
export async function getOAuthAccessToken(
  userId: string
): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const row = await db
      .select()
      .from(anthropicOauthTokens)
      .where(eq(anthropicOauthTokens.userId, userId))
      .get()

    if (!row) return null

    const encryptionKey = envValue(env, "PROVIDER_KEY_ENCRYPTION_KEY")

    if (!encryptionKey) return null

    const isExpired =
      Date.now() >
      new Date(row.expiresAt).getTime() - 5 * 60 * 1000

    if (!isExpired) {
      return await decrypt(row.accessToken, encryptionKey, userId)
    }

    // Token expired — refresh
    const refreshToken = await decrypt(
      row.refreshToken,
      encryptionKey,
      userId
    )
    const fresh = await refreshToken_(refreshToken)

    const encryptedAccess = await encrypt(
      fresh.access,
      encryptionKey,
      userId
    )
    const encryptedRefresh = await encrypt(
      fresh.refresh,
      encryptionKey,
      userId
    )
    const now = new Date().toISOString()
    const expiresAt = new Date(fresh.expiresAt).toISOString()

    await db
      .update(anthropicOauthTokens)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(anthropicOauthTokens.userId, userId))
      .run()

    return fresh.access
  } catch (err) {
    console.error("Failed to get/refresh OAuth access token:", err)
    return null
  }
}

export async function disconnectOAuth(): Promise<{
  success: true
}> {
  const user = await getCurrentUser()
  if (!user) {
    // Still return success shape — nothing to disconnect
    return { success: true }
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  await db
    .delete(anthropicOauthTokens)
    .where(eq(anthropicOauthTokens.userId, user.id))
    .run()

  await deleteUserProviderConfig(db, user.id)

  revalidatePath("/dashboard")
  return { success: true }
}

export async function getOAuthStatus(): Promise<{
  connected: boolean
  expiresAt?: string
}> {
  try {
    const context = await userContext()
    if (!context.success) return { connected: false }
    const { user, db } = context.data

    const row = await db
      .select()
      .from(anthropicOauthTokens)
      .where(eq(anthropicOauthTokens.userId, user.id))
      .get()

    if (!row) return { connected: false }

    return { connected: true, expiresAt: row.expiresAt }
  } catch {
    return { connected: false }
  }
}
