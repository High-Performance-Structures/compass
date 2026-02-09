"use server"

import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db-universal"
import { creditMemos, type NewCreditMemo } from "@/db/schema-netsuite"
import { getCurrentUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

export async function getCreditMemos() {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const db = await getDb()

  return db.select().from(creditMemos)
}

export async function getCreditMemo(id: string) {
  const user = await getCurrentUser()
  requirePermission(user, "finance", "read")

  const db = await getDb()

  const rows = await db
    .select()
    .from(creditMemos)
    .where(eq(creditMemos.id, id))
    .limit(1)

  return rows[0] ?? null
}

export async function createCreditMemo(
  data: Omit<NewCreditMemo, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "create")

    const db = await getDb()

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db.insert(creditMemos).values({
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
        err instanceof Error
          ? err.message
          : "Failed to create credit memo",
    }
  }
}

export async function updateCreditMemo(
  id: string,
  data: Partial<NewCreditMemo>
) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "update")

    const db = await getDb()

    await db
      .update(creditMemos)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(creditMemos.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update credit memo",
    }
  }
}

export async function deleteCreditMemo(id: string) {
  try {
    const user = await getCurrentUser()
    requirePermission(user, "finance", "delete")

    const db = await getDb()

    await db.delete(creditMemos).where(eq(creditMemos.id, id))

    revalidatePath("/dashboard/financials")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to delete credit memo",
    }
  }
}
