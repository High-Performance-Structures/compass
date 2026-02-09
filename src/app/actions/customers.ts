"use server"

import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { customers, type NewCustomer } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getCustomers() {
  const user = await getCurrentUser()
  requirePermission(user, "customer", "read")

  const db = await getDb()

  return db.select().from(customers)
}

export async function getCustomer(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "customer", "read")

  const db = await getDb()

  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createCustomer(
  data: Omit<NewCustomer, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "customer", "create")

    const db = await getDb()

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(customers).values({
      id,
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
    const user = await getCurrentUser()
    requirePermission(user, "customer", "update")

    const db = await getDb()

    await db
      .update(customers)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(customers.id, id))

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
    const user = await getCurrentUser()
    requirePermission(user, "customer", "delete")

    const db = await getDb()

    await db.delete(customers).where(eq(customers.id, id))

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
