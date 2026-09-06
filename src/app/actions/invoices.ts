"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { invoices, type NewInvoice } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { omitOwnerArSourceFields } from "@/lib/financials/owner-ar"

export async function getInvoices(projectId?: string) {
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
      .from(invoices)
      .where(eq(invoices.projectId, projectId))
  }

  // join through projects to filter by org
    return db
      .select({
        id: invoices.id,
        netsuiteId: invoices.netsuiteId,
        organizationId: invoices.organizationId,
        customerId: invoices.customerId,
        projectId: invoices.projectId,
        sourceSystem: invoices.sourceSystem,
        sourceExternalId: invoices.sourceExternalId,
        invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      amountDue: invoices.amountDue,
      memo: invoices.memo,
      lineItems: invoices.lineItems,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
}

export async function getInvoice(id: string) {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through project to verify org
  const rows = await db
    .select({
      id: invoices.id,
      netsuiteId: invoices.netsuiteId,
      organizationId: invoices.organizationId,
      customerId: invoices.customerId,
      projectId: invoices.projectId,
      sourceSystem: invoices.sourceSystem,
      sourceExternalId: invoices.sourceExternalId,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      tax: invoices.tax,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      amountDue: invoices.amountDue,
      memo: invoices.memo,
      lineItems: invoices.lineItems,
      createdAt: invoices.createdAt,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(and(eq(invoices.id, id), eq(projects.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createInvoice(
  data: Omit<NewInvoice, "id" | "createdAt" | "updatedAt">
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
    const safeData = omitOwnerArSourceFields(data)

    await db.insert(invoices).values({
      id,
      ...safeData,
      organizationId: orgId,
      sourceSystem: "compass",
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify invoice belongs to org via project
    const [existing] = await db
      .select({ projectId: invoices.projectId })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Invoice not found or access denied" }
    }

    const safeData = omitOwnerArSourceFields(data)
    if (safeData.projectId !== undefined && safeData.projectId !== null && safeData.projectId !== existing.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, safeData.projectId), eq(projects.organizationId, orgId)))
        .limit(1)
      if (!project) {
        return { success: false, error: "Project not found or access denied" }
      }
    }
    await db
      .update(invoices)
      .set({ ...safeData, updatedAt: new Date().toISOString() })
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify invoice belongs to org via project
    const [existing] = await db
      .select({ projectId: invoices.projectId })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Invoice not found or access denied" }
    }

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
