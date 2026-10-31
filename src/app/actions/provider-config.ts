"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { userProviderConfig } from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { encrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"
import {
  deleteUserProviderConfig,
  saveUserProviderConfig,
  updateUserModelOverrides as storeModelOverrides,
} from "@/lib/domain/settings/store"
import { envValue } from "@/lib/shared/env"

// --- types ---

interface ProviderConfigData {
  readonly providerType: string
  readonly hasApiKey: boolean
  readonly baseUrl: string | null
  readonly modelOverrides: Record<string, string> | null
  readonly isActive: boolean
}

// --- actions ---

export async function getUserProviderConfig(): Promise<
  | { success: true; data: ProviderConfigData | null }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return { success: false, error: "Permission denied" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(userProviderConfig)
      .where(eq(userProviderConfig.userId, user.id))
      .get()

    if (!config) {
      return { success: true, data: null }
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
      success: true,
      data: {
        providerType: config.providerType,
        hasApiKey: config.apiKey !== null,
        baseUrl: config.baseUrl,
        modelOverrides,
        isActive: config.isActive === 1,
      },
    }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to get provider config",
    }
  }
}

export async function setUserProviderConfig(
  providerType: string,
  apiKey?: string,
  baseUrl?: string,
  modelOverrides?: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return { success: false, error: "Permission denied" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    let encryptedApiKey: string | null = null
    if (apiKey) {
      const encryptionKey = envValue(env, "PROVIDER_KEY_ENCRYPTION_KEY")

      if (!encryptionKey) {
        return {
          success: false,
          error:
            "Encryption key not configured (PROVIDER_KEY_ENCRYPTION_KEY)",
        }
      }
      encryptedApiKey = await encrypt(
        apiKey,
        encryptionKey,
        user.id
      )
    }

    const now = new Date().toISOString()
    const modelOverridesJson = modelOverrides
      ? JSON.stringify(modelOverrides)
      : null

    await saveUserProviderConfig(db, {
      userId: user.id,
      providerType,
      apiKey: encryptedApiKey,
      baseUrl: baseUrl ?? null,
      modelOverrides: modelOverridesJson,
      updatedAt: now,
    })

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to set provider config",
    }
  }
}

export async function updateUserModelOverrides(
  modelOverrides: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return { success: false, error: "Permission denied" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select()
      .from(userProviderConfig)
      .where(eq(userProviderConfig.userId, user.id))
      .get()

    if (!existing) {
      return {
        success: false,
        error: "No provider configured — save a provider first",
      }
    }

    const now = new Date().toISOString()

    await storeModelOverrides(db, user.id, JSON.stringify(modelOverrides), now)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update model overrides",
    }
  }
}

export async function clearUserProviderConfig(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }
    if (!can(user, "agent", "update")) {
      return { success: false, error: "Permission denied" }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await deleteUserProviderConfig(db, user.id)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to clear provider config",
    }
  }
}
