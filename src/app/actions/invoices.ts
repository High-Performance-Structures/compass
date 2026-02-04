"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { invoices, type NewInvoice } from "@/db/schema-netsuite"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getInvoices(projectId?: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  if (projectId) {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.projectId, projectId))
  }
  return db.select().from(invoices)
}

export async function getInvoice(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createInvoice(
  data: Omit<NewInvoice, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "create")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(invoices).values({
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
      error: err instanceof Error ? err.message : "Failed to create invoice",
    }
  }
}

export async function updateInvoice(
  id: string,
  data: Partial<NewInvoice>
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "update")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .update(invoices)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(invoices.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update invoice",
    }
  }
}

export async function deleteInvoice(id: string) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "delete")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db.delete(invoices).where(eq(invoices.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete invoice",
    }
  }
}
