"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { vendorBills, type NewVendorBill } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

export async function getVendorBills(projectId?: string) {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  if (projectId) {
    // verify project belongs to org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      throw new Error("Project not found or access denied")
    }

    return db
      .select()
      .from(vendorBills)
      .where(eq(vendorBills.projectId, projectId))
  }

  // join through projects to filter by org
  return db
    .select({
      id: vendorBills.id,
      netsuiteId: vendorBills.netsuiteId,
      vendorId: vendorBills.vendorId,
      projectId: vendorBills.projectId,
      billNumber: vendorBills.billNumber,
      status: vendorBills.status,
      billDate: vendorBills.billDate,
      dueDate: vendorBills.dueDate,
      subtotal: vendorBills.subtotal,
      tax: vendorBills.tax,
      total: vendorBills.total,
      amountPaid: vendorBills.amountPaid,
      amountDue: vendorBills.amountDue,
      memo: vendorBills.memo,
      lineItems: vendorBills.lineItems,
      createdAt: vendorBills.createdAt,
      updatedAt: vendorBills.updatedAt,
    })
    .from(vendorBills)
    .innerJoin(projects, eq(vendorBills.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
}

export async function getVendorBill(id: string) {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through project to verify org
  const rows = await db
    .select({
      id: vendorBills.id,
      netsuiteId: vendorBills.netsuiteId,
      vendorId: vendorBills.vendorId,
      projectId: vendorBills.projectId,
      billNumber: vendorBills.billNumber,
      status: vendorBills.status,
      billDate: vendorBills.billDate,
      dueDate: vendorBills.dueDate,
      subtotal: vendorBills.subtotal,
      tax: vendorBills.tax,
      total: vendorBills.total,
      amountPaid: vendorBills.amountPaid,
      amountDue: vendorBills.amountDue,
      memo: vendorBills.memo,
      lineItems: vendorBills.lineItems,
      createdAt: vendorBills.createdAt,
      updatedAt: vendorBills.updatedAt,
    })
    .from(vendorBills)
    .innerJoin(projects, eq(vendorBills.projectId, projects.id))
    .where(and(eq(vendorBills.id, id), eq(projects.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createVendorBill(
  data: Omit<NewVendorBill, "id" | "createdAt" | "updatedAt">
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify bill belongs to org via project
    const [existing] = await db
      .select({ projectId: vendorBills.projectId })
      .from(vendorBills)
      .innerJoin(projects, eq(vendorBills.projectId, projects.id))
      .where(and(eq(vendorBills.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Bill not found or access denied" }
    }

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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify bill belongs to org via project
    const [existing] = await db
      .select({ projectId: vendorBills.projectId })
      .from(vendorBills)
      .innerJoin(projects, eq(vendorBills.projectId, projects.id))
      .where(and(eq(vendorBills.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Bill not found or access denied" }
    }

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
