"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { mcpApiKeys } from "@/db/schema-mcp"
import { eq, and } from "drizzle-orm"
import { getCurrentUser } from "@/lib/auth"
import {
  generateApiKey,
  hashApiKey,
} from "@/lib/mcp/auth"
import { revalidatePath } from "next/cache"

export async function createApiKey(
  name: string,
  scopes: ReadonlyArray<string>
): Promise<
  | { success: true; key: string }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()

    const { key, keyPrefix } = generateApiKey()
    const keyHash = await hashApiKey(key)

    await db
      .insert(mcpApiKeys)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        name,
        keyPrefix,
        keyHash,
        scopes: JSON.stringify(scopes),
        createdAt: now,
        isActive: true,
      })
      .run()

    revalidatePath("/dashboard")

    return { success: true, key }
  } catch (error) {
    console.error("Failed to create API key:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function listApiKeys(): Promise<
  | {
      success: true
      data: ReadonlyArray<{
        readonly id: string
        readonly name: string
        readonly keyPrefix: string
        readonly scopes: ReadonlyArray<string>
        readonly lastUsedAt: string | null
        readonly createdAt: string
        readonly expiresAt: string | null
        readonly isActive: boolean
      }>
    }
  | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select({
        id: mcpApiKeys.id,
        name: mcpApiKeys.name,
        keyPrefix: mcpApiKeys.keyPrefix,
        scopes: mcpApiKeys.scopes,
        lastUsedAt: mcpApiKeys.lastUsedAt,
        createdAt: mcpApiKeys.createdAt,
        expiresAt: mcpApiKeys.expiresAt,
        isActive: mcpApiKeys.isActive,
      })
      .from(mcpApiKeys)
      .where(eq(mcpApiKeys.userId, user.id))
      .all()

    const data = rows.map((row) => ({
      ...row,
      scopes: JSON.parse(row.scopes) as ReadonlyArray<string>,
    }))

    return { success: true, data }
  } catch (error) {
    console.error("Failed to list API keys:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function revokeApiKey(
  keyId: string
): Promise<
  { success: true } | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ userId: mcpApiKeys.userId })
      .from(mcpApiKeys)
      .where(
        and(
          eq(mcpApiKeys.id, keyId),
          eq(mcpApiKeys.userId, user.id)
        )
      )
      .get()

    if (!existing) {
      return { success: false, error: "Key not found" }
    }

    await db
      .update(mcpApiKeys)
      .set({ isActive: false })
      .where(eq(mcpApiKeys.id, keyId))
      .run()

    revalidatePath("/dashboard")

    return { success: true }
  } catch (error) {
    console.error("Failed to revoke API key:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}

export async function deleteApiKey(
  keyId: string
): Promise<
  { success: true } | { success: false; error: string }
> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ userId: mcpApiKeys.userId })
      .from(mcpApiKeys)
      .where(
        and(
          eq(mcpApiKeys.id, keyId),
          eq(mcpApiKeys.userId, user.id)
        )
      )
      .get()

    if (!existing) {
      return { success: false, error: "Key not found" }
    }

    await db
      .delete(mcpApiKeys)
      .where(eq(mcpApiKeys.id, keyId))
      .run()

    revalidatePath("/dashboard")

    return { success: true }
  } catch (error) {
    console.error("Failed to delete API key:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }
  }
}
