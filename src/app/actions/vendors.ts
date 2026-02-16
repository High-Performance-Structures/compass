"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { vendors, type NewVendor } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getVendors() {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db.select().from(vendors).where(eq(vendors.organizationId, orgId))
}

export async function getVendor(id: string) {
  const user = await requireAuth()
  requirePermission(user, "vendor", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createVendor(
  data: Omit<NewVendor, "id" | "createdAt" | "updatedAt" | "organizationId">
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "vendor", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(vendors).values({
      id,
      organizationId: orgId,
      ...data,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/vendors")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create vendor",
    }
  }
}

export async function updateVendor(
  id: string,
  data: Partial<NewVendor>
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "vendor", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .update(vendors)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))

    revalidatePath("/dashboard/vendors")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update vendor",
    }
  }
}

export async function deleteVendor(id: string) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "vendor", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.organizationId, orgId)))

    revalidatePath("/dashboard/vendors")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete vendor",
    }
  }
}
