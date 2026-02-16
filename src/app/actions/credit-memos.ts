"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { creditMemos, type NewCreditMemo } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getCreditMemos() {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through projects to filter by org
  return db
    .select({
      id: creditMemos.id,
      netsuiteId: creditMemos.netsuiteId,
      customerId: creditMemos.customerId,
      projectId: creditMemos.projectId,
      memoNumber: creditMemos.memoNumber,
      status: creditMemos.status,
      issueDate: creditMemos.issueDate,
      total: creditMemos.total,
      amountApplied: creditMemos.amountApplied,
      amountRemaining: creditMemos.amountRemaining,
      memo: creditMemos.memo,
      lineItems: creditMemos.lineItems,
      createdAt: creditMemos.createdAt,
      updatedAt: creditMemos.updatedAt,
    })
    .from(creditMemos)
    .innerJoin(projects, eq(creditMemos.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
}

export async function getCreditMemo(id: string) {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through project to verify org
  const rows = await db
    .select({
      id: creditMemos.id,
      netsuiteId: creditMemos.netsuiteId,
      customerId: creditMemos.customerId,
      projectId: creditMemos.projectId,
      memoNumber: creditMemos.memoNumber,
      status: creditMemos.status,
      issueDate: creditMemos.issueDate,
      total: creditMemos.total,
      amountApplied: creditMemos.amountApplied,
      amountRemaining: creditMemos.amountRemaining,
      memo: creditMemos.memo,
      lineItems: creditMemos.lineItems,
      createdAt: creditMemos.createdAt,
      updatedAt: creditMemos.updatedAt,
    })
    .from(creditMemos)
    .innerJoin(projects, eq(creditMemos.projectId, projects.id))
    .where(and(eq(creditMemos.id, id), eq(projects.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createCreditMemo(
  data: Omit<NewCreditMemo, "id" | "createdAt" | "updatedAt">
) {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "create")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to org if provided
    if (data.projectId) {
      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, data.projectId), eq(projects.organizationId, orgId)))
        .limit(1)

      if (!project) {
        return { success: false, error: "Project not found or access denied" }
      }
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify credit memo belongs to org via project
    const [existing] = await db
      .select({ projectId: creditMemos.projectId })
      .from(creditMemos)
      .innerJoin(projects, eq(creditMemos.projectId, projects.id))
      .where(and(eq(creditMemos.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Credit memo not found or access denied" }
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify credit memo belongs to org via project
    const [existing] = await db
      .select({ projectId: creditMemos.projectId })
      .from(creditMemos)
      .innerJoin(projects, eq(creditMemos.projectId, projects.id))
      .where(and(eq(creditMemos.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Credit memo not found or access denied" }
    }

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
