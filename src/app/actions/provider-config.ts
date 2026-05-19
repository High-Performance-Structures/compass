"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import {
  userProviderConfig,
  agentConfig,
} from "@/db/schema-ai-config"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { encrypt, decrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"

// --- constants ---

const ORG_DEFAULT_USER_ID = "org_default"

// --- types ---

interface ProviderConfigData {
  readonly providerType: string
  readonly hasApiKey: boolean
  readonly baseUrl: string | null
  readonly modelOverrides: Record<string, string> | null
  readonly isActive: boolean
}

interface ProviderConfigForJwt {
  readonly type: string
  readonly apiKey: string | null
  readonly baseUrl: string | null
  readonly modelOverrides: Record<string, string> | null
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

    if (!config) {
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

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.id, "global"))
      .get()

    const isAdmin = can(user, "agent", "update")

    if (
      !isAdmin &&
      config &&
      config.allowUserSelection !== 1
    ) {
      return {
        success: false,
        error: "User provider selection is disabled",
      }
    }

    let encryptedApiKey: string | null = null
    if (apiKey) {
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

    await db
      .insert(userProviderConfig)
      .values({
        userId: user.id,
        providerType,
        apiKey: encryptedApiKey,
        baseUrl: baseUrl ?? null,
        modelOverrides: modelOverridesJson,
        isActive: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProviderConfig.userId,
        set: {
          providerType,
          apiKey: encryptedApiKey,
          baseUrl: baseUrl ?? null,
          modelOverrides: modelOverridesJson,
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

    await db
      .update(userProviderConfig)
      .set({
        modelOverrides: JSON.stringify(modelOverrides),
        updatedAt: now,
      })
      .where(eq(userProviderConfig.userId, user.id))
      .run()

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

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(userProviderConfig)
      .where(eq(userProviderConfig.userId, user.id))
      .run()

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

export async function getOrgProviderConfig(): Promise<
  | { success: true; data: ProviderConfigData | null }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (!can(user, "agent", "update")) {
      return {
        success: false,
        error: "Permission denied",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const config = await db
      .select()
      .from(userProviderConfig)
      .where(
        eq(userProviderConfig.userId, ORG_DEFAULT_USER_ID)
      )
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
          : "Failed to get org provider config",
    }
  }
}

export async function setOrgProviderConfig(
  providerType: string,
  apiKey?: string,
  baseUrl?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    if (!can(user, "agent", "update")) {
      return {
        success: false,
        error: "Permission denied",
      }
    }

    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    let encryptedApiKey: string | null = null
    if (apiKey) {
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
      encryptedApiKey = await encrypt(
        apiKey,
        encryptionKey,
        ORG_DEFAULT_USER_ID
      )
    }

    const now = new Date().toISOString()

    await db
      .insert(userProviderConfig)
      .values({
        userId: ORG_DEFAULT_USER_ID,
        providerType,
        apiKey: encryptedApiKey,
        baseUrl: baseUrl ?? null,
        modelOverrides: null,
        isActive: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProviderConfig.userId,
        set: {
          providerType,
          apiKey: encryptedApiKey,
          baseUrl: baseUrl ?? null,
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
          : "Failed to set org provider config",
    }
  }
}
