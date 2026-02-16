"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { customers, type NewCustomer } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getCustomers() {
  const user = await requireAuth()
  requirePermission(user, "customer", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db.select().from(customers).where(eq(customers.organizationId, orgId))
}

export async function getCustomer(id: string) {
  const user = await requireAuth()
  requirePermission(user, "customer", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createCustomer(
  data: Omit<NewCustomer, "id" | "createdAt" | "updatedAt" | "organizationId">
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "customer", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(customers).values({
      id,
      organizationId: orgId,
      ...data,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/customers")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create customer",
    }
  }
}

export async function updateCustomer(
  id: string,
  data: Partial<NewCustomer>
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "customer", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .update(customers)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))

    revalidatePath("/dashboard/customers")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update customer",
    }
  }
}

export async function deleteCustomer(id: string) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "customer", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.organizationId, orgId)))

    revalidatePath("/dashboard/customers")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete customer",
    }
  }
}
