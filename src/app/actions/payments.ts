"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { payments, type NewPayment } from "@/db/schema-netsuite"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getPayments() {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  return db.select().from(payments)
}

export async function getPayment(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createPayment(
  data: Omit<NewPayment, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(payments).values({
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
      error:
        err instanceof Error ? err.message : "Failed to create payment",
    }
  }
}

export async function updatePayment(
  id: string,
  data: Partial<NewPayment>
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "update")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .update(payments)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(payments.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to update payment",
    }
  }
}

export async function deletePayment(id: string) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "delete")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db.delete(payments).where(eq(payments.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to delete payment",
    }
  }
}
