"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { customers, vendors } from "@/db/schema"
import { getNetSuiteConfig } from "@/lib/netsuite/config"
import { TokenManager } from "@/lib/netsuite/auth/token-manager"
import { getAuthorizeUrl } from "@/lib/netsuite/auth/oauth-client"
import { SyncEngine } from "@/lib/netsuite/sync/sync-engine"
import { CustomerMapper } from "@/lib/netsuite/mappers/customer-mapper"
import { VendorMapper } from "@/lib/netsuite/mappers/vendor-mapper"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getNetSuiteConnectionStatus() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "read")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getNetSuiteConfig(envRecord)
    const db = getDb(env.DB)
    const tokenManager = new TokenManager(config, db as never)
    const connected = await tokenManager.hasTokens()

    return {
      configured: true,
      connected,
      accountId: config.accountId,
    }
  } catch {
    return { configured: false, connected: false, accountId: null }
  }
}

export async function initiateNetSuiteOAuth() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "organization", "update")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getNetSuiteConfig(envRecord)

    const state = crypto.randomUUID()
    const authorizeUrl = getAuthorizeUrl(config, state)

    return { success: true, authorizeUrl, state }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Configuration error",
    }
  }
}

export async function disconnectNetSuite() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "organization", "update")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getNetSuiteConfig(envRecord)
    const db = getDb(env.DB)
    const tokenManager = new TokenManager(config, db as never)
    await tokenManager.clearTokens()

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disconnect",
    }
  }
}

export async function syncCustomers() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "customer", "update")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const engine = new SyncEngine(db as never, envRecord)
    const mapper = new CustomerMapper()

    const result = await engine.pull(
      mapper,
      async (localId, data) => {
        const now = new Date().toISOString()
        if (localId) {
          await db
            .update(customers)
            .set({ ...data, updatedAt: now } as never)
            .where(eq(customers.id, localId))
          return localId
        }
        const id = crypto.randomUUID()
        await db.insert(customers).values({
          id,
          name: String(data.name ?? ""),
          email: (data.email as string) ?? null,
          phone: (data.phone as string) ?? null,
          netsuiteId: (data.netsuiteId as string) ?? null,
          createdAt: now,
          updatedAt: now,
        })
        return id
      }
    )

    revalidatePath("/dashboard")
    return {
      success: true,
      pulled: result.pull?.pulled ?? 0,
      created: result.pull?.created ?? 0,
      updated: result.pull?.updated ?? 0,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Sync failed",
    }
  }
}

export async function syncVendors() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "vendor", "update")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const engine = new SyncEngine(db as never, envRecord)
    const mapper = new VendorMapper()

    const result = await engine.pull(
      mapper,
      async (localId, data) => {
        const now = new Date().toISOString()
        if (localId) {
          await db
            .update(vendors)
            .set({ ...data, updatedAt: now } as never)
            .where(eq(vendors.id, localId))
          return localId
        }
        const id = crypto.randomUUID()
        await db.insert(vendors).values({
          id,
          name: String(data.name ?? ""),
          category: (data.category as string) ?? "Subcontractor",
          email: (data.email as string) ?? null,
          phone: (data.phone as string) ?? null,
          address: (data.address as string) ?? null,
          netsuiteId: (data.netsuiteId as string) ?? null,
          createdAt: now,
          updatedAt: now,
        })
        return id
      }
    )

    revalidatePath("/dashboard")
    return {
      success: true,
      pulled: result.pull?.pulled ?? 0,
      created: result.pull?.created ?? 0,
      updated: result.pull?.updated ?? 0,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Sync failed",
    }
  }
}

export async function getSyncHistory() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "read")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const engine = new SyncEngine(db as never, envRecord)
    return { success: true, history: await engine.getSyncHistory() }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed",
      history: [],
    }
  }
}

export async function getConflicts() {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "read")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const engine = new SyncEngine(db as never, envRecord)
    return { success: true, conflicts: await engine.getConflicts() }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed",
      conflicts: [],
    }
  }
}

export async function resolveConflict(
  metaId: string,
  resolution: "use_local" | "use_remote"
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "update")
    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const db = getDb(env.DB)
    const engine = new SyncEngine(db as never, envRecord)
    await engine.resolveConflict(metaId, resolution)

    revalidatePath("/dashboard")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed",
    }
  }
}
