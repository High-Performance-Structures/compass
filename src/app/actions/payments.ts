"use server"

import { getCloudflareContext } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getDb } from "@/db"
import { payments, type NewPayment } from "@/db/schema-netsuite"
import { projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { omitOwnerArSourceFields } from "@/lib/financials/owner-ar"

export async function getPayments() {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through projects to filter by org
  return db
    .select({
      id: payments.id,
      netsuiteId: payments.netsuiteId,
      organizationId: payments.organizationId,
      customerId: payments.customerId,
      vendorId: payments.vendorId,
      projectId: payments.projectId,
      sourceSystem: payments.sourceSystem,
      sourceExternalId: payments.sourceExternalId,
      paymentType: payments.paymentType,
      amount: payments.amount,
      grossAmountCents: payments.grossAmountCents,
      processingFeeCents: payments.processingFeeCents,
      netAmountCents: payments.netAmountCents,
      cashReceipt: payments.cashReceipt,
      paymentDate: payments.paymentDate,
      paymentMethod: payments.paymentMethod,
      referenceNumber: payments.referenceNumber,
      memo: payments.memo,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(projects, eq(payments.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
}

export async function getPayment(id: string) {
  const user = await requireAuth()
  requirePermission(user, "finance", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // join through project to verify org
  const rows = await db
    .select({
      id: payments.id,
      netsuiteId: payments.netsuiteId,
      organizationId: payments.organizationId,
      customerId: payments.customerId,
      vendorId: payments.vendorId,
      projectId: payments.projectId,
      sourceSystem: payments.sourceSystem,
      sourceExternalId: payments.sourceExternalId,
      paymentType: payments.paymentType,
      amount: payments.amount,
      grossAmountCents: payments.grossAmountCents,
      processingFeeCents: payments.processingFeeCents,
      netAmountCents: payments.netAmountCents,
      cashReceipt: payments.cashReceipt,
      paymentDate: payments.paymentDate,
      paymentMethod: payments.paymentMethod,
      referenceNumber: payments.referenceNumber,
      memo: payments.memo,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(projects, eq(payments.projectId, projects.id))
    .where(and(eq(payments.id, id), eq(projects.organizationId, orgId)))
    .limit(1)

  return rows[0] ?? null
}

export async function createPayment(
  data: Omit<NewPayment, "id" | "createdAt" | "updatedAt">
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

    await db.insert(payments).values({
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify payment belongs to org via project
    const [existing] = await db
      .select({ projectId: payments.projectId })
      .from(payments)
      .innerJoin(projects, eq(payments.projectId, projects.id))
      .where(and(eq(payments.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Payment not found or access denied" }
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
      .update(payments)
      .set({ ...safeData, updatedAt: new Date().toISOString() })
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "finance", "delete")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify payment belongs to org via project
    const [existing] = await db
      .select({ projectId: payments.projectId })
      .from(payments)
      .innerJoin(projects, eq(payments.projectId, projects.id))
      .where(and(eq(payments.id, id), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Payment not found or access denied" }
    }

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
