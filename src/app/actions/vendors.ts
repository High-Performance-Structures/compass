"use server"

import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { vendors, type NewVendor } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getVendors() {
  const user = await getCurrentUser()
  requirePermission(user, "vendor", "read")

  const db = await getDb()

  return db.select().from(vendors)
}

export async function getVendor(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "vendor", "read")

  const db = await getDb()

  const rows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createVendor(
  data: Omit<NewVendor, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "vendor", "create")

    const db = await getDb()

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(vendors).values({
      id,
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
    const user = await getCurrentUser()
    requirePermission(user, "vendor", "update")

    const db = await getDb()

    await db
      .update(vendors)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(vendors.id, id))

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
    const user = await getCurrentUser()
    requirePermission(user, "vendor", "delete")

    const db = await getDb()

    await db.delete(vendors).where(eq(vendors.id, id))

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
