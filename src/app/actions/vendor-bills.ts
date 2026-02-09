"use server"

import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { vendorBills, type NewVendorBill } from "@/db/schema-netsuite"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getVendorBills(projectId?: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const db = await getDb()

  if (projectId) {
    return db
      .select()
      .from(vendorBills)
      .where(eq(vendorBills.projectId, projectId))
  }
  return db.select().from(vendorBills)
}

export async function getVendorBill(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const db = await getDb()

  const rows = await db
    .select()
    .from(vendorBills)
    .where(eq(vendorBills.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createVendorBill(
  data: Omit<NewVendorBill, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "create")

    const db = await getDb()

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(vendorBills).values({
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/financials")
    return { success: true, id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create bill",
    }
  }
}

export async function updateVendorBill(
  id: string,
  data: Partial<NewVendorBill>
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "update")

    const db = await getDb()

    await db
      .update(vendorBills)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(vendorBills.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update bill",
    }
  }
}

export async function deleteVendorBill(id: string) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "delete")

    const db = await getDb()

    await db.delete(vendorBills).where(eq(vendorBills.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete bill",
    }
  }
}
