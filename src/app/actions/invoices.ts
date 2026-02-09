"use server"

import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { invoices, type NewInvoice } from "@/db/schema-netsuite"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getInvoices(projectId?: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const db = await getDb()

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

  const db = await getDb()

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

    const db = await getDb()

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

    const db = await getDb()

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

    const db = await getDb()

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
